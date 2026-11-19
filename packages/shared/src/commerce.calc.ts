import { TaxMode } from './enums';
import { DiscountType } from './commerce.enums';

export interface SaleLineCalculationInput {
  quantity: number;
  unitPriceXof: number;
  discountType?: DiscountType;
  discountValue?: number;
}

export interface CalculatedSaleLine {
  quantity: number;
  unitPriceXof: number;
  grossXof: number;
  discountXof: number;
  netBeforeTaxXof: number;
  taxXof: number;
  lineTotalXof: number;
}

export interface SaleCalculationInput {
  lines: SaleLineCalculationInput[];
  globalDiscountType?: DiscountType;
  globalDiscountValue?: number;
  taxMode: TaxMode;
  defaultTaxRateBps: number; // ex. 1800 = 18.00 %
  cashRoundingStep?: 0 | 5 | 25;
}

export interface CalculatedSaleTotals {
  lines: CalculatedSaleLine[];
  grossSubtotalXof: number;
  lineDiscountTotalXof: number;
  globalDiscountXof: number;
  discountTotalXof: number;
  subtotalAfterDiscountXof: number;
  taxTotalXof: number;
  roundingXof: number;
  totalXof: number;
  effectiveDiscountPercent: number;
}

/**
 * Calcule le Coût Moyen Pondéré (CMP) entier en XOF lors d'une réception de stock (Section 6.5).
 * Si le stock précédent est <= 0 ou sans coût connu, le nouveau CMP prend le coût unitaire reçu.
 */
export function calculateWeightedAverageCost(
  currentQty: number,
  currentCostXof: number | null,
  receivedQty: number,
  receivedUnitCostXof: number,
): number {
  const safeReceivedQty = Math.max(0, Math.round(receivedQty));
  const safeUnitCost = Math.max(0, Math.round(receivedUnitCostXof));
  if (safeReceivedQty === 0) {
    return currentCostXof ?? safeUnitCost;
  }
  if (currentQty <= 0 || currentCostXof === null) {
    return safeUnitCost;
  }
  const totalValue = currentQty * currentCostXof + safeReceivedQty * safeUnitCost;
  const totalQty = currentQty + safeReceivedQty;
  return Math.round(totalValue / totalQty);
}

/**
 * Calcule les montants d'une vente exclusivement en entiers XOF (Critère de recette #23).
 * Invariant garanti :
 * - Tous les montants retournés sont des entiers exacts
 * - L'écart d'arrondi espèces (optionnel : 5 ou 25 XOF) est conservé explicitement dans `roundingXof`
 * - En mode TTC, la taxe est extraite sans majorer le prix client
 * - En mode HT, la taxe est calculée et ajoutée proprement au total
 */
export function calculateSaleTotals(input: SaleCalculationInput): CalculatedSaleTotals {
  const rateBps = input.taxMode === 'NONE' ? 0 : Math.max(0, Math.round(input.defaultTaxRateBps));

  const calculatedLines: CalculatedSaleLine[] = input.lines.map((line) => {
    const qty = Math.max(1, Math.round(line.quantity));
    const unitPriceXof = Math.max(0, Math.round(line.unitPriceXof));
    const grossXof = qty * unitPriceXof;

    let discountXof = 0;
    if (line.discountType === 'PERCENT' && line.discountValue) {
      discountXof = Math.round((grossXof * Math.min(100, Math.max(0, line.discountValue))) / 100);
    } else if (line.discountType === 'AMOUNT' && line.discountValue) {
      discountXof = Math.min(grossXof, Math.max(0, Math.round(line.discountValue)));
    }

    const afterLineDiscount = Math.max(0, grossXof - discountXof);

    let netBeforeTaxXof = afterLineDiscount;
    let taxXof = 0;
    let lineTotalXof = afterLineDiscount;

    if (input.taxMode === 'HT' && rateBps > 0) {
      taxXof = Math.round((afterLineDiscount * rateBps) / 10_000);
      lineTotalXof = afterLineDiscount + taxXof;
    } else if (input.taxMode === 'TTC' && rateBps > 0) {
      netBeforeTaxXof = Math.round((afterLineDiscount * 10_000) / (10_000 + rateBps));
      taxXof = afterLineDiscount - netBeforeTaxXof;
      lineTotalXof = afterLineDiscount;
    }

    return {
      quantity: qty,
      unitPriceXof,
      grossXof,
      discountXof,
      netBeforeTaxXof,
      taxXof,
      lineTotalXof,
    };
  });

  const grossSubtotalXof = calculatedLines.reduce((acc, l) => acc + l.grossXof, 0);
  const lineDiscountTotalXof = calculatedLines.reduce((acc, l) => acc + l.discountXof, 0);
  const afterLinesBeforeGlobal = grossSubtotalXof - lineDiscountTotalXof;

  let globalDiscountXof = 0;
  if (input.globalDiscountType === 'PERCENT' && input.globalDiscountValue) {
    globalDiscountXof = Math.round(
      (afterLinesBeforeGlobal * Math.min(100, Math.max(0, input.globalDiscountValue))) / 100,
    );
  } else if (input.globalDiscountType === 'AMOUNT' && input.globalDiscountValue) {
    globalDiscountXof = Math.min(
      afterLinesBeforeGlobal,
      Math.max(0, Math.round(input.globalDiscountValue)),
    );
  }

  const discountTotalXof = lineDiscountTotalXof + globalDiscountXof;
  const subtotalAfterDiscountXof = Math.max(0, grossSubtotalXof - discountTotalXof);

  let taxTotalXof = 0;
  let preRoundingTotalXof = subtotalAfterDiscountXof;

  if (input.taxMode === 'HT' && rateBps > 0) {
    // Recalcule la taxe globale sur le net après remise globale pour conserver exactitude de la somme
    taxTotalXof = Math.round((subtotalAfterDiscountXof * rateBps) / 10_000);
    preRoundingTotalXof = subtotalAfterDiscountXof + taxTotalXof;
  } else if (input.taxMode === 'TTC' && rateBps > 0) {
    const netTotal = Math.round((subtotalAfterDiscountXof * 10_000) / (10_000 + rateBps));
    taxTotalXof = subtotalAfterDiscountXof - netTotal;
    preRoundingTotalXof = subtotalAfterDiscountXof;
  }

  const step = input.cashRoundingStep ?? 0;
  let totalXof = preRoundingTotalXof;
  let roundingXof = 0;
  if (step === 5 || step === 25) {
    totalXof = Math.round(preRoundingTotalXof / step) * step;
    roundingXof = totalXof - preRoundingTotalXof;
  }

  const effectiveDiscountPercent =
    grossSubtotalXof > 0 ? Number(((discountTotalXof * 100) / grossSubtotalXof).toFixed(2)) : 0;

  return {
    lines: calculatedLines,
    grossSubtotalXof,
    lineDiscountTotalXof,
    globalDiscountXof,
    discountTotalXof,
    subtotalAfterDiscountXof,
    taxTotalXof,
    roundingXof,
    totalXof,
    effectiveDiscountPercent,
  };
}
