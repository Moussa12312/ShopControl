import { z } from 'zod';
import {
  FULFILLMENT_MODES,
  ONLINE_ORDER_STATUSES,
  PLATFORM_MODULES,
  SUBSCRIPTION_PLANS,
  SUPPORT_TICKET_STATUSES,
} from './platform.enums';

const xofInt = z.number().int('Le montant XOF doit être un entier.').min(0);
const positiveInt = z.number().int('Quantité entière positive requise.').min(1);

// --- Paramètres Boutique : Logo, Tickets (Lot 3) & Livraison Vitrine (Lot 5) ---
export const receiptSettingsSchema = z.object({
  slogan: z.string().trim().max(160).optional().default(''),
  headerText: z.string().trim().max(300).optional().default(''),
  footerText: z
    .string()
    .trim()
    .max(300)
    .optional()
    .default('Merci pour votre confiance ! Conservez ce justificatif.'),
  showLogo: z.boolean().default(true),
  paperWidthMm: z.union([z.literal(58), z.literal(80)]).default(80),
  legalNotice: z
    .string()
    .trim()
    .max(300)
    .optional()
    .default('Ticket de caisse / Justificatif de vente — document commercial.'),
});

export type ReceiptSettingsConfig = z.infer<typeof receiptSettingsSchema>;

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettingsConfig = {
  slogan: '',
  headerText: '',
  footerText: 'Merci pour votre confiance ! Conservez ce justificatif.',
  showLogo: true,
  paperWidthMm: 80,
  legalNotice: 'Ticket de caisse / Justificatif de vente — document commercial.',
};

export const deliveryZoneSchema = z.object({
  name: z.string().trim().min(1).max(80),
  feeXof: xofInt,
});

export const deliveryConfigSchema = z.object({
  pickupEnabled: z.boolean().default(true),
  deliveryEnabled: z.boolean().default(true),
  defaultDeliveryFeeXof: xofInt.default(1000),
  deliveryZones: z.array(deliveryZoneSchema).max(30).default([]),
  allowOutOfHoursOrders: z.boolean().default(true),
  outOfHoursMessage: z
    .string()
    .trim()
    .max(240)
    .optional()
    .default('Votre commande sera traitée dès la prochaine ouverture de la boutique.'),
  whatsappNumber: z.string().trim().max(30).optional().default(''),
  maxOrderQty: z.number().int().min(1).max(1000).default(100),
  maxOrderAmountXof: xofInt.default(5_000_000),
  maxOrdersPerPhonePerHour: z.number().int().min(1).max(50).default(5),
});

export type DeliveryConfig = z.infer<typeof deliveryConfigSchema>;

export const DEFAULT_DELIVERY_CONFIG: DeliveryConfig = {
  pickupEnabled: true,
  deliveryEnabled: true,
  defaultDeliveryFeeXof: 1000,
  deliveryZones: [],
  allowOutOfHoursOrders: true,
  outOfHoursMessage: 'Votre commande sera traitée dès la prochaine ouverture de la boutique.',
  whatsappNumber: '',
  maxOrderQty: 100,
  maxOrderAmountXof: 5_000_000,
  maxOrdersPerPhonePerHour: 5,
};

// --- Upload Image (Photos produits, Logo boutique, Pièce jointe photo) ---
export const uploadImageSchema = z.object({
  dataUrl: z
    .string()
    .min(30, 'Image invalide.')
    .max(7_500_000, 'Image trop volumineuse (maximum 5 Mo).'),
  purpose: z.enum(['product', 'logo', 'message']).default('product'),
});

// --- Lot 4 : Transferts inter-boutiques ---
export const createTransferSchema = z.object({
  sourceShopId: z.string().uuid('Boutique source invalide.'),
  destShopId: z.string().uuid('Boutique destination invalide.'),
  notes: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        sourceProductId: z.string().uuid('Produit source invalide.'),
        requestedQty: positiveInt,
      }),
    )
    .min(1, 'Sélectionnez au moins un article à transférer.'),
});

export const rejectTransferSchema = z.object({
  reason: z.string().trim().min(5, 'Un motif de refus (5+ caractères) est obligatoire.').max(500),
});

export const receiveTransferSchema = z.object({
  notes: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        receivedQty: z.number().int().min(0),
        discrepancyReason: z.string().trim().max(300).optional(),
      }),
    )
    .min(1, 'Renseignez les quantités reçues.'),
});

export const generateDailyReportSchema = z.object({
  reportDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format date attendu : AAAA-MM-JJ.')
    .optional(),
});

// --- Lot 5 : Vitrine E-commerce & Commandes publiques ---
export const createPublicOrderSchema = z.object({
  clientName: z.string().trim().min(2, 'Votre nom est requis.').max(120),
  clientPhone: z
    .string()
    .trim()
    .min(6, 'Numéro de téléphone invalide.')
    .max(30)
    .regex(/^[+0-9\s()-]{6,30}$/, 'Format de téléphone invalide.'),
  fulfillmentMode: z.enum(FULFILLMENT_MODES),
  deliveryAddress: z.string().trim().max(255).optional(),
  deliveryDistrict: z.string().trim().max(100).optional(),
  deliveryNotes: z.string().trim().max(400).optional(),
  marketingConsent: z.boolean().default(false),
  websiteHp: z.string().max(120).optional(), // champ pot-de-miel anti-robot discret (doit rester vide)
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullable().optional(),
        selectedSize: z.string().trim().max(32).nullable().optional(),
        selectedColor: z.string().trim().max(40).nullable().optional(),
        quantity: positiveInt,
      }),
    )
    .min(1, 'Votre panier est vide.'),
});

export const trackOrderLookupSchema = z.object({
  orderNumber: z.string().trim().min(4, 'Référence de commande requise.').max(40),
  clientPhone: z.string().trim().min(6, 'Numéro de téléphone requis.').max(30),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(ONLINE_ORDER_STATUSES),
  reason: z.string().trim().max(500).optional(),
});

export const completeOrderToSaleSchema = z.object({
  paymentMethodCode: z.string().trim().min(2).max(32).default('CASH'),
  amountPaidXof: xofInt,
  transactionRef: z.string().trim().max(120).optional(),
  deliveredQuantities: z
    .array(
      z.object({
        orderLineId: z.string().uuid(),
        deliveredQty: z.number().int().min(0),
      }),
    )
    .optional(),
  notes: z.string().trim().max(400).optional(),
});

export const blockPhoneSchema = z.object({
  phone: z.string().trim().min(6, 'Numéro de téléphone invalide.').max(30),
  reason: z.string().trim().max(300).optional(),
});

// --- Compte client optionnel sur vitrine publique ---
export const customerRegisterSchema = z.object({
  fullName: z.string().trim().min(2, 'Votre nom complet est requis.').max(120),
  phone: z.string().trim().min(6, 'Numéro de téléphone valide requis.').max(30),
  email: z.string().trim().email('Adresse e-mail invalide.').toLowerCase().optional().or(z.literal('')),
  address: z.string().trim().max(255).optional().or(z.literal('')),
  password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères.').max(128),
});

export const customerLoginSchema = z.object({
  identifier: z.string().trim().min(4, 'Téléphone ou e-mail requis.').max(160),
  password: z.string().min(1, 'Mot de passe requis.').max(128),
});

// --- Lot 6 : Messagerie ---
export const createConversationSchema = z.object({
  type: z.enum(['INTERNAL_OWNER_AGENT', 'CLIENT_SHOP', 'SUPPORT_ADMIN_OWNER']),
  shopId: z.string().uuid().nullable().optional(),
  merchantId: z.string().uuid().optional(),
  subject: z.string().trim().min(2, 'Objet requis.').max(160),
  clientName: z.string().trim().max(120).optional(),
  clientPhone: z.string().trim().max(30).optional(),
  orderId: z.string().uuid().optional(),
  orderNumber: z.string().trim().max(40).optional(),
  initialMessage: z.string().trim().min(1, 'Message requis.').max(2000),
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, 'Le message ne peut pas être vide.').max(2000),
  attachmentUrl: z.string().trim().max(500).optional().nullable(),
});

export const startPublicChatSchema = z.object({
  clientName: z.string().trim().min(2, 'Votre nom est requis.').max(120),
  clientPhone: z.string().trim().min(6, 'Votre numéro est requis.').max(30),
  orderSecretToken: z.string().trim().max(120).optional(),
  message: z.string().trim().min(1, 'Écrivez votre message.').max(1500),
});

export const assignConversationSchema = z.object({
  assignedAgentUserId: z.string().uuid().nullable(),
});

// --- Lot 7 : Administration Plateforme ---
export const upsertSubscriptionSchema = z.object({
  planCode: z.enum(SUBSCRIPTION_PLANS),
  monthlyPriceXof: xofInt,
  maxShops: z.number().int().min(1).max(100),
  maxAgentsPerShop: z.number().int().min(1).max(100),
  enabledModules: z.array(z.enum(PLATFORM_MODULES)).min(1),
  currentPeriodEnd: z.string().datetime().optional(),
  autoSuspendGraceDays: z.number().int().min(1).max(60).default(7),
});

export const recordPlatformPaymentSchema = z.object({
  merchantId: z.string().uuid('Marchand invalide.'),
  amountXof: z.number().int().min(1, 'Montant positif requis.'),
  paymentMethodCode: z.string().trim().min(2).max(32),
  reference: z.string().trim().max(120).optional(),
  periodLabel: z.string().trim().min(2, 'Période couverte requise.').max(80),
  notes: z.string().trim().max(300).optional(),
  reactivateIfPastDue: z.boolean().default(true),
});

export const createSupportTicketSchema = z.object({
  subject: z.string().trim().min(4, 'Objet du ticket requis.').max(180),
  priority: z.enum(['INFO', 'WARNING', 'URGENT']).default('INFO'),
  message: z.string().trim().min(5, 'Décrivez votre demande.').max(2000),
});

export const replySupportTicketSchema = z.object({
  body: z.string().trim().min(1, 'Réponse requise.').max(2000),
});

export const updateSupportTicketStatusSchema = z.object({
  status: z.enum(SUPPORT_TICKET_STATUSES),
});

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(3, 'Titre requis.').max(160),
  body: z.string().trim().min(5, 'Contenu requis.').max(1500),
  priority: z.enum(['INFO', 'WARNING', 'URGENT']).default('INFO'),
  targetRole: z.enum(['ALL', 'OWNER', 'AGENT']).default('ALL'),
  expiresAt: z.string().datetime().nullable().optional(),
});
