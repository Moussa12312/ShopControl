// ============================================================================
// LOTS 3 à 7 — ENUMS & LIBELLÉS MÉTIER (DOCUMENTS, TRANSFERTS, E-COMMERCE, MESSAGERIE, ADMIN)
// ============================================================================

export const DOCUMENT_TYPES = ['SALE_RECEIPT', 'CREDIT_NOTE'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  SALE_RECEIPT: 'Ticket de caisse / Justificatif de vente',
  CREDIT_NOTE: 'Avoir / Justificatif de remboursement',
};

export const TRANSFER_STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'IN_TRANSIT',
  'RECEIVED',
  'RECEIVED_WITH_DISCREPANCY',
  'CANCELLED',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  PENDING_APPROVAL: 'En attente de validation',
  APPROVED: 'Validé (prêt à expédier)',
  REJECTED: 'Refusé',
  IN_TRANSIT: 'En transit',
  RECEIVED: 'Reçu conforme',
  RECEIVED_WITH_DISCREPANCY: 'Reçu avec écart',
  CANCELLED: 'Annulé',
};

export const DAILY_REPORT_STATUSES = ['PROVISIONAL', 'FINAL', 'SUPERSEDED'] as const;
export type DailyReportStatus = (typeof DAILY_REPORT_STATUSES)[number];

export const DAILY_REPORT_STATUS_LABELS: Record<DailyReportStatus, string> = {
  PROVISIONAL: 'Provisoire (caisse ouverte)',
  FINAL: 'Définitif',
  SUPERSEDED: 'Remplacé',
};

// Section 8.7 — 9 statuts exacts de commande vitrine QR
export const ONLINE_ORDER_STATUSES = [
  'NEW',
  'CONFIRMED',
  'REJECTED',
  'PREPARING',
  'READY',
  'IN_DELIVERY',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type OnlineOrderStatus = (typeof ONLINE_ORDER_STATUSES)[number];

export const ONLINE_ORDER_STATUS_LABELS: Record<OnlineOrderStatus, string> = {
  NEW: 'Nouvelle',
  CONFIRMED: 'Confirmée (stock réservé)',
  REJECTED: 'Refusée',
  PREPARING: 'En préparation',
  READY: 'Prête',
  IN_DELIVERY: 'En livraison',
  COMPLETED: 'Livrée / Retirée',
  CANCELLED: 'Annulée',
  EXPIRED: 'Expirée',
};

export const FULFILLMENT_MODES = ['PICKUP', 'DELIVERY'] as const;
export type FulfillmentMode = (typeof FULFILLMENT_MODES)[number];

export const FULFILLMENT_MODE_LABELS: Record<FulfillmentMode, string> = {
  PICKUP: 'Retrait en boutique',
  DELIVERY: 'Livraison',
};

export const CONVERSATION_TYPES = [
  'INTERNAL_OWNER_AGENT',
  'CLIENT_SHOP',
  'SUPPORT_ADMIN_OWNER',
] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export const CONVERSATION_TYPE_LABELS: Record<ConversationType, string> = {
  INTERNAL_OWNER_AGENT: 'Équipe boutique',
  CLIENT_SHOP: 'Client vitrine',
  SUPPORT_ADMIN_OWNER: 'Support plateforme',
};

export const SUBSCRIPTION_PLANS = ['STARTER', 'PRO', 'ENTERPRISE'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_PLAN_LABELS: Record<SubscriptionPlan, string> = {
  STARTER: 'Starter (1 boutique)',
  PRO: 'Pro (Multi-boutiques)',
  ENTERPRISE: 'Entreprise (Illimité)',
};

export const SUBSCRIPTION_BILLING_CYCLES = ['MONTHLY', 'YEARLY', 'DIRECT_SALE'] as const;
export type SubscriptionBillingCycle = (typeof SUBSCRIPTION_BILLING_CYCLES)[number];

export const SUBSCRIPTION_BILLING_CYCLE_LABELS: Record<SubscriptionBillingCycle, string> = {
  MONTHLY: 'Par mois',
  YEARLY: 'Par année',
  DIRECT_SALE: 'Vente directe',
};

export const SUBSCRIPTION_BILLING_CYCLE_SUFFIX: Record<SubscriptionBillingCycle, string> = {
  MONTHLY: '/ mois',
  YEARLY: '/ an',
  DIRECT_SALE: 'achat unique',
};

export const PLATFORM_MODULES = [
  'POS',
  'INVENTORY',
  'PURCHASES',
  'MULTI_SHOP',
  'ECOMMERCE_QR',
  'MESSAGING',
  'REPORTS',
] as const;
export type PlatformModuleKey = (typeof PLATFORM_MODULES)[number];

export const PLATFORM_MODULE_LABELS: Record<PlatformModuleKey, string> = {
  POS: 'Comptoir POS & Caisse',
  INVENTORY: 'Catalogue & Stocks',
  PURCHASES: 'Achats & Fournisseurs',
  MULTI_SHOP: 'Transferts Multi-boutiques',
  ECOMMERCE_QR: 'Vitrine E-commerce & QR Code',
  MESSAGING: 'Messagerie Intégrée',
  REPORTS: 'Bilans & Rapports Consolidés',
};

export const SUPPORT_TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export const SUPPORT_TICKET_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  OPEN: 'Ouvert',
  IN_PROGRESS: 'En cours',
  RESOLVED: 'Résolu',
  CLOSED: 'Fermé',
};
