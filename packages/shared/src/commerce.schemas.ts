import { z } from 'zod';
import {
  DISCOUNT_TYPES,
  IMPORT_ENTITY_TYPES,
  PRODUCT_STATUSES,
  SALE_RETURN_CONDITIONS,
} from './commerce.enums';
import { CATEGORY_SELLING_MODES } from './shop-profiles';

const xofInt = z.number().int('Le montant XOF doit être un nombre entier.').min(0);
const positiveInt = z.number().int('La quantité doit être un entier positif.').min(1);

// --- Catégories & Produits ---
export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'Nom de catégorie requis.').max(80),
  sellingMode: z.enum(CATEGORY_SELLING_MODES).default('STANDARD_PIECE'),
  description: z.string().trim().max(300).optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export const updateCategorySchema = createCategorySchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const productVariantInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Nom de variante requis.').max(80),
  sku: z.string().trim().max(64).optional().or(z.literal('')),
  barcode: z.string().trim().max(64).optional().or(z.literal('')),
  salePriceXof: xofInt.nullable().optional(),
  costPriceXof: xofInt.nullable().optional(),
  alertThreshold: z.number().int().min(0).default(5),
  isActive: z.boolean().default(true),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(2, 'Le nom du produit est requis.').max(140),
  sku: z.string().trim().max(64).optional().or(z.literal('')),
  barcode: z.string().trim().max(64).optional().or(z.literal('')),
  description: z.string().trim().max(2000).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  unit: z.string().trim().min(1).max(24).default('unité'),
  salePriceXof: xofInt,
  costPriceXof: xofInt.nullable().optional(),
  alertThreshold: z.number().int().min(0).default(5),
  status: z.enum(PRODUCT_STATUSES).default('DRAFT'),
  imageUrls: z.array(z.string().trim().max(500)).max(10).default([]),
  availableSizes: z.array(z.string().trim().min(1).max(32)).max(30).default([]),
  availableColors: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  // Attributs sectoriels (Lots 8, 9, 10)
  brand: z.string().trim().max(80).nullable().optional(),
  modelName: z.string().trim().max(100).nullable().optional(),
  volumeLabel: z.string().trim().max(40).nullable().optional(),
  isPinnedPos: z.boolean().default(false),
  bulkUnitLabel: z.string().trim().max(32).nullable().optional(),
  unitsPerBulk: z.number().int().min(2).max(10000).nullable().optional(),
  bulkSalePriceXof: xofInt.nullable().optional(),
  allowFractionalSale: z.boolean().default(false),
  expiryDate: z.string().datetime().nullable().optional(),
  batchNumber: z.string().trim().max(60).nullable().optional(),
  warrantyMonths: z.number().int().min(0).max(120).nullable().optional(),
  trackSerialNumber: z.boolean().default(false),
  initialStockQty: z.number().int().min(0).optional(),
  variants: z.array(productVariantInputSchema).max(50).optional(),
});

export const updateProductSchema = createProductSchema
  .omit({ initialStockQty: true, batchNumber: true })
  .partial();

export const createProductBatchSchema = z.object({
  productId: z.string().uuid('Produit requis.'),
  batchNumber: z.string().trim().max(60).optional(),
  expiryDate: z.string().datetime('Date de péremption invalide.'),
  quantity: positiveInt,
  notes: z.string().trim().max(300).optional(),
});

export const writeOffBatchSchema = z.object({
  reason: z.string().trim().min(4, 'Motif de mise au rebut requis.').max(400),
});

// --- Stocks & Inventaire ---
export const stockAdjustmentSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  quantityDelta: z
    .number()
    .int()
    .refine((v) => v !== 0, 'La quantité d’ajustement doit être non nulle.'),
  movementType: z.enum(['MANUAL_IN', 'MANUAL_OUT', 'INVENTORY_ADJUSTMENT', 'RETURN_DAMAGED_LOSS']),
  reason: z.string().trim().min(5, 'Un motif détaillé est obligatoire.').max(500),
});

export const physicalInventorySchema = z.object({
  reason: z.string().trim().min(4, 'Libellé ou motif d’inventaire obligatoire.').max(300),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullable().optional(),
        countedQty: z.number().int().min(0),
      }),
    )
    .min(1, 'Renseignez au moins un article compté.'),
});

// --- Fournisseurs & Achats ---
export const createSupplierSchema = z.object({
  name: z.string().trim().min(2, 'Nom du fournisseur requis.').max(120),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email('E-mail invalide.').optional().or(z.literal('')),
  address: z.string().trim().max(255).optional(),
  suppliedProducts: z.string().trim().max(400).optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().uuid('Fournisseur obligatoire.'),
  expectedDate: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(500).optional(),
  submitImmediately: z.boolean().default(true),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullable().optional(),
        orderedQty: positiveInt,
        unitCostXof: xofInt,
      }),
    )
    .min(1, 'Ajoutez au moins un article à la commande fournisseur.'),
});

export const receivePurchaseOrderSchema = z.object({
  notes: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        purchaseOrderItemId: z.string().uuid(),
        receivedQty: positiveInt,
        unitCostXof: xofInt.optional(),
        receivedInBulk: z.boolean().default(false),
        expiryDate: z.string().datetime().nullable().optional(),
        batchNumber: z.string().trim().max(60).nullable().optional(),
      }),
    )
    .min(1, 'Renseignez au moins une ligne reçue.'),
});

export const supplierPaymentSchema = z.object({
  amountXof: z.number().int().min(1, 'Le montant payé doit être positif.'),
  paymentMethodCode: z.string().trim().min(2).max(32),
  transactionRef: z.string().trim().max(120).optional(),
  paidFromCashDrawer: z.boolean().default(false),
  notes: z.string().trim().max(300).optional(),
});

// --- Clients & Créances ---
export const createClientSchema = z.object({
  fullName: z.string().trim().min(2, 'Nom du client requis.').max(120),
  phone: z.string().trim().min(6, 'Numéro de téléphone requis.').max(30),
  email: z.string().trim().email('E-mail invalide.').optional().or(z.literal('')),
  address: z.string().trim().max(255).optional(),
  creditLimitXof: xofInt.default(0),
  notes: z.string().trim().max(500).optional(),
});

export const updateClientSchema = createClientSchema.partial().extend({
  isBlocked: z.boolean().optional(),
});

export const createManualReceivableSchema = z.object({
  clientId: z.string().uuid('Client requis.'),
  amountXof: z.number().int().min(1, 'Le montant de la dette doit être positif.'),
  description: z.string().trim().min(2, 'Précisez le motif ou libellé de la dette.').max(400),
  dueDate: z.string().datetime().nullable().optional(),
  allowCreditOverride: z.boolean().default(false),
});

export const receivablePaymentSchema = z.object({
  amountXof: z.number().int().min(1, 'Le montant encaissé doit être positif.'),
  paymentMethodCode: z.string().trim().min(2).max(32),
  transactionRef: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(300).optional(),
});

// --- Caisse ---
export const createCashRegisterSchema = z.object({
  name: z.string().trim().min(2, 'Nom de caisse requis.').max(80),
});

export const openCashSessionSchema = z.object({
  registerId: z.string().uuid().optional(),
  openingAmountXof: xofInt,
  notes: z.string().trim().max(300).optional(),
});

export const manualCashMovementSchema = z.object({
  type: z.enum(['MANUAL_IN', 'MANUAL_OUT']),
  amountXof: z.number().int().min(1, 'Montant positif requis.'),
  reason: z.string().trim().min(4, 'Motif obligatoire pour un mouvement manuel.').max(300),
});

export const handoverCashSessionSchema = z.object({
  countedAmountXof: xofInt,
  notes: z.string().trim().max(300).optional(),
});

export const closeCashSessionSchema = z.object({
  countedAmountXof: xofInt,
  notes: z.string().trim().max(500).optional(),
});

export const regularizeCashSessionSchema = z.object({
  type: z.enum(['REGULARIZATION_IN', 'REGULARIZATION_OUT']),
  amountXof: z.number().int().min(1, 'Montant positif requis.'),
  reason: z
    .string()
    .trim()
    .min(8, 'Un motif détaillé est obligatoire pour régulariser une clôture.')
    .max(500),
});

// --- Ventes POS ---
export const saleLineInputSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  quantity: positiveInt.default(1),
  soldInBulk: z.boolean().default(false),
  customAmountXof: z.number().int().min(1).max(100_000_000).nullable().optional(),
  fractionalQtyMilli: z.number().int().min(1).max(100_000_000).nullable().optional(),
  serialNumber: z.string().trim().max(120).nullable().optional(),
  discountType: z.enum(DISCOUNT_TYPES).default('NONE'),
  discountValue: z.number().min(0).default(0),
});

export const salePaymentInputSchema = z.object({
  paymentMethodCode: z.string().trim().min(2).max(32),
  amountXof: z.number().int().min(1, 'Montant de paiement positif requis.'),
  transactionRef: z.string().trim().max(120).optional(),
});

export const createSaleSchema = z.object({
  clientOperationId: z.string().trim().min(6).max(120).optional(),
  clientId: z.string().uuid().nullable().optional(),
  lines: z.array(saleLineInputSchema).min(1, 'Ajoutez au moins un article au panier.'),
  globalDiscountType: z.enum(DISCOUNT_TYPES).default('NONE'),
  globalDiscountValue: z.number().min(0).default(0),
  cashRoundingStep: z.union([z.literal(0), z.literal(5), z.literal(25)]).default(0),
  payments: z.array(salePaymentInputSchema).default([]),
  allowCreditOverride: z.boolean().default(false),
  notes: z.string().trim().max(400).optional(),
  // Champs Option B (synchronisation vente comptoir hors-ligne)
  offlineSaleNumber: z.string().trim().max(40).optional(),
  offlineCapturedAt: z.string().datetime().optional(),
});

export const cancelSaleSchema = z.object({
  reason: z.string().trim().min(5, 'Un motif d’annulation est obligatoire.').max(500),
  refundCashFromDrawer: z.boolean().default(true),
});

export const createSaleReturnSchema = z.object({
  reason: z.string().trim().min(5, 'Motif du retour obligatoire.').max(500),
  items: z
    .array(
      z.object({
        saleLineId: z.string().uuid(),
        quantity: positiveInt,
        condition: z.enum(SALE_RETURN_CONDITIONS),
      }),
    )
    .min(1, 'Sélectionnez au moins un article retourné.'),
});

export const createSaleRefundSchema = z.object({
  amountXof: z.number().int().min(1, 'Montant de remboursement positif requis.'),
  paymentMethodCode: z.string().trim().min(2).max(32),
  transactionRef: z.string().trim().max(120).optional(),
  reason: z.string().trim().min(5, 'Motif du remboursement obligatoire.').max(500),
});

// --- Dépenses ---
export const createExpenseCategorySchema = z.object({
  name: z.string().trim().min(2, 'Nom de catégorie requis.').max(80),
});

export const createExpenseSchema = z.object({
  categoryId: z.string().uuid('Catégorie de dépense requise.'),
  amountXof: z.number().int().min(1, 'Le montant doit être supérieur à 0 XOF.'),
  expenseDate: z.string().datetime().optional(),
  paymentMethodCode: z.string().trim().min(2).max(32).default('CASH'),
  paidFromCashDrawer: z.boolean().default(true),
  beneficiary: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

export const createCompanyExpenseSchema = z.object({
  categoryName: z.string().trim().min(2, 'Catégorie requise.').max(80),
  amountXof: z.number().int().min(1, 'Le montant doit être supérieur à 0 XOF.'),
  expenseDate: z.string().datetime().optional(),
  paymentMethodCode: z.string().trim().min(2).max(32).default('BANK'),
  beneficiary: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

export const cancelExpenseSchema = z.object({
  reason: z.string().trim().min(5, 'Motif d’annulation obligatoire.').max(500),
});

// --- Import CSV ---
export const csvImportSchema = z.object({
  entityType: z.enum(IMPORT_ENTITY_TYPES),
  csvContent: z.string().min(3, 'Contenu CSV vide.').max(2_000_000),
  fileName: z.string().trim().max(160).optional(),
});
