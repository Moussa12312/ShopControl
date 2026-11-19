export const PRODUCT_STATUSES = ['DRAFT', 'PUBLISHED', 'UNAVAILABLE', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: 'Brouillon',
  PUBLISHED: 'Publié',
  UNAVAILABLE: 'Indisponible',
  ARCHIVED: 'Archivé',
};

export const STOCK_MOVEMENT_TYPES = [
  'INITIAL_IMPORT',
  'PURCHASE_RECEIPT',
  'SALE_OUT',
  'SALE_CANCEL_IN',
  'RETURN_RESELLABLE_IN',
  'RETURN_DAMAGED_LOSS',
  'MANUAL_IN',
  'MANUAL_OUT',
  'INVENTORY_ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  INITIAL_IMPORT: 'Import stock initial',
  PURCHASE_RECEIPT: 'Réception fournisseur',
  SALE_OUT: 'Vente',
  SALE_CANCEL_IN: 'Annulation vente',
  RETURN_RESELLABLE_IN: 'Retour revendable',
  RETURN_DAMAGED_LOSS: 'Perte / retour non revendable',
  MANUAL_IN: 'Entrée manuelle',
  MANUAL_OUT: 'Sortie manuelle',
  INVENTORY_ADJUSTMENT: 'Correction inventaire',
  TRANSFER_OUT: 'Transfert expédié',
  TRANSFER_IN: 'Transfert reçu',
};

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Brouillon',
  ORDERED: 'Commandé',
  PARTIALLY_RECEIVED: 'Reçu partiellement',
  RECEIVED: 'Reçu',
  CANCELLED: 'Annulé',
};

export const CASH_SESSION_STATUSES = ['OPEN', 'CLOSED'] as const;
export type CashSessionStatus = (typeof CASH_SESSION_STATUSES)[number];

export const CASH_MOVEMENT_TYPES = [
  'SALE_IN',
  'RECEIVABLE_IN',
  'MANUAL_IN',
  'MANUAL_OUT',
  'EXPENSE_OUT',
  'REFUND_OUT',
  'SUPPLIER_OUT',
  'REGULARIZATION_IN',
  'REGULARIZATION_OUT',
  'HANDOVER_COUNT',
] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

export const SALE_STATUSES = ['DRAFT', 'COMPLETED', 'CANCELLED'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_RETURN_CONDITIONS = ['RESELLABLE', 'DAMAGED_LOSS'] as const;
export type SaleReturnCondition = (typeof SALE_RETURN_CONDITIONS)[number];

export const DISCOUNT_TYPES = ['NONE', 'PERCENT', 'AMOUNT'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const RECEIVABLE_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

export const EXPENSE_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const IMPORT_ENTITY_TYPES = ['PRODUCTS', 'SUPPLIERS', 'CLIENTS'] as const;
export type ImportEntityType = (typeof IMPORT_ENTITY_TYPES)[number];

export const DEFAULT_EXPENSE_CATEGORY_NAMES = [
  'Loyer',
  'Électricité / Eau',
  'Transport / Livraison',
  'Salaires informels',
  'Fournitures boutique',
  'Autres dépenses',
] as const;
