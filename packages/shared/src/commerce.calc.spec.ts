import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSaleTotals,
  calculateWeightedAverageCost,
} from './commerce.calc';

describe('@shopcontrol/shared — calculs financiers XOF & CMP (Critère #23)', () => {
  it('calcule correctement le Coût Moyen Pondéré (CMP) entier en XOF', () => {
    // 10 unités à 1000 XOF + 10 unités reçues à 1500 XOF => CMP = 1250 XOF
    assert.equal(calculateWeightedAverageCost(10, 1000, 10, 1500), 1250);
    // Stock précédent sans coût => prend le coût reçu
    assert.equal(calculateWeightedAverageCost(5, null, 10, 2000), 2000);
    // Stock précédent négatif (conflit hors-ligne) => prend le coût reçu
    assert.equal(calculateWeightedAverageCost(-2, 1000, 10, 1800), 1800);
  });

  it('garantit des montants entiers XOF, taxes HT/TTC et arrondi espèces tracé', () => {
    const ht = calculateSaleTotals({
      lines: [
        { quantity: 2, unitPriceXof: 1250, discountType: 'NONE', discountValue: 0 },
        { quantity: 1, unitPriceXof: 500, discountType: 'AMOUNT', discountValue: 50 },
      ],
      taxMode: 'HT',
      defaultTaxRateBps: 1800, // 18%
      cashRoundingStep: 25,
    });

    assert.equal(ht.grossSubtotalXof, 3000);
    assert.equal(ht.discountTotalXof, 50);
    assert.equal(ht.subtotalAfterDiscountXof, 2950);
    assert.equal(ht.taxTotalXof, 531); // 18% de 2950 = 531 exact
    // 2950 + 531 = 3481 -> arrondi au 25 XOF le plus proche = 3475 (écart -6 XOF tracé)
    assert.equal(ht.totalXof, 3475);
    assert.equal(ht.roundingXof, -6);
    assert.equal(ht.subtotalAfterDiscountXof + ht.taxTotalXof + ht.roundingXof, ht.totalXof);

    const ttc = calculateSaleTotals({
      lines: [{ quantity: 1, unitPriceXof: 11800 }],
      taxMode: 'TTC',
      defaultTaxRateBps: 1800,
    });
    assert.equal(ttc.totalXof, 11800);
    assert.equal(ttc.taxTotalXof, 1800);
  });
});
