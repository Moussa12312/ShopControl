import { z } from 'zod';
import {
  DEFAULT_CURRENCY,
  DEFAULT_DAILY_REPORT_TIME,
  DEFAULT_TIMEZONE,
  TAX_MODES,
  TENANT_STATUSES,
} from './enums';
import { PERMISSION_KEYS } from './permissions';
import { SUBSCRIPTION_BILLING_CYCLES, SUBSCRIPTION_PLANS } from './platform.enums';
import { deliveryConfigSchema, receiptSettingsSchema } from './platform.schemas';
import { businessProfileSchema, SHOP_TYPES } from './shop-profiles';

const strongPasswordSchema = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères.')
  .max(128, 'Le mot de passe est trop long.')
  .regex(/[A-Z]/, 'Le mot de passe doit contenir au moins une majuscule.')
  .regex(/[a-z]/, 'Le mot de passe doit contenir au moins une minuscule.')
  .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre.');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'L’identifiant URL doit contenir au moins 2 caractères.')
  .max(64, 'L’identifiant URL ne peut pas dépasser 64 caractères.')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Utilisez uniquement des lettres minuscules, chiffres et tirets.',
  );

export const timeHHmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format horaire attendu : HH:MM (ex. 22:00).');

export const paymentMethodConfigSchema = z.object({
  code: z.string().trim().min(2).max(32),
  label: z.string().trim().min(2).max(60),
  enabled: z.boolean(),
  requireReference: z.boolean().default(false),
  affectsCashDrawer: z.boolean().default(false),
});

export type PaymentMethodConfig = z.infer<typeof paymentMethodConfigSchema>;

export interface CountryOption {
  code: string;
  name: string;
  flag: string;
  currency: string;
  timezone: string;
  methods: PaymentMethodConfig[];
}

export const COUNTRY_PRESETS: Record<string, CountryOption> = {
  ML: {
    code: 'ML',
    name: 'Mali',
    flag: '🇲🇱',
    currency: 'XOF',
    timezone: 'Africa/Bamako',
    methods: [
      { code: 'CASH', label: 'Espèces', enabled: true, requireReference: false, affectsCashDrawer: true },
      { code: 'ORANGE_MONEY', label: 'Orange Money (Mali)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'WAVE', label: 'Wave (Mali)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'MOOV_MONEY', label: 'Moov Money (Mali)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'BANK_TRANSFER', label: 'Virement bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
      { code: 'CARD', label: 'Carte bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
    ],
  },
  CI: {
    code: 'CI',
    name: "Côte d'Ivoire",
    flag: '🇨🇮',
    currency: 'XOF',
    timezone: 'Africa/Abidjan',
    methods: [
      { code: 'CASH', label: 'Espèces', enabled: true, requireReference: false, affectsCashDrawer: true },
      { code: 'WAVE', label: 'Wave (CI)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'ORANGE_MONEY', label: 'Orange Money (CI)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'MTN_MOMO', label: 'MTN MoMo (CI)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'MOOV_MONEY', label: 'Moov Money (CI)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'BANK_TRANSFER', label: 'Virement bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
      { code: 'CARD', label: 'Carte bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
    ],
  },
  SN: {
    code: 'SN',
    name: 'Sénégal',
    flag: '🇸🇳',
    currency: 'XOF',
    timezone: 'Africa/Dakar',
    methods: [
      { code: 'CASH', label: 'Espèces', enabled: true, requireReference: false, affectsCashDrawer: true },
      { code: 'WAVE', label: 'Wave (Sénégal)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'ORANGE_MONEY', label: 'Orange Money (Sénégal)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'FREE_MONEY', label: 'Free Money', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'BANK_TRANSFER', label: 'Virement bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
      { code: 'CARD', label: 'Carte bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
    ],
  },
  BF: {
    code: 'BF',
    name: 'Burkina Faso',
    flag: '🇧🇫',
    currency: 'XOF',
    timezone: 'Africa/Ouagadougou',
    methods: [
      { code: 'CASH', label: 'Espèces', enabled: true, requireReference: false, affectsCashDrawer: true },
      { code: 'ORANGE_MONEY', label: 'Orange Money (BF)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'MOOV_MONEY', label: 'Moov Money (BF)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'BANK_TRANSFER', label: 'Virement bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
      { code: 'CARD', label: 'Carte bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
    ],
  },
  GN: {
    code: 'GN',
    name: 'Guinée',
    flag: '🇬🇳',
    currency: 'GNF',
    timezone: 'Africa/Conakry',
    methods: [
      { code: 'CASH', label: 'Espèces', enabled: true, requireReference: false, affectsCashDrawer: true },
      { code: 'ORANGE_MONEY', label: 'Orange Money (Guinée)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'MTN_MOMO', label: 'MTN MoMo (Guinée)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'BANK_TRANSFER', label: 'Virement bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
      { code: 'CARD', label: 'Carte bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
    ],
  },
  TG: {
    code: 'TG',
    name: 'Togo',
    flag: '🇹🇬',
    currency: 'XOF',
    timezone: 'Africa/Lome',
    methods: [
      { code: 'CASH', label: 'Espèces', enabled: true, requireReference: false, affectsCashDrawer: true },
      { code: 'TMONEY', label: 'T-Money (Togocom)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'MOOV_MONEY', label: 'Moov Money (Flooz)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'BANK_TRANSFER', label: 'Virement bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
      { code: 'CARD', label: 'Carte bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
    ],
  },
  BJ: {
    code: 'BJ',
    name: 'Bénin',
    flag: '🇧🇯',
    currency: 'XOF',
    timezone: 'Africa/Porto-Novo',
    methods: [
      { code: 'CASH', label: 'Espèces', enabled: true, requireReference: false, affectsCashDrawer: true },
      { code: 'MTN_MOMO', label: 'MTN MoMo (Bénin)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'MOOV_MONEY', label: 'Moov Money (Flooz)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'CELTIIS_CASH', label: 'Celtiis Cash', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'BANK_TRANSFER', label: 'Virement bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
      { code: 'CARD', label: 'Carte bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
    ],
  },
  NE: {
    code: 'NE',
    name: 'Niger',
    flag: '🇳🇪',
    currency: 'XOF',
    timezone: 'Africa/Niamey',
    methods: [
      { code: 'CASH', label: 'Espèces', enabled: true, requireReference: false, affectsCashDrawer: true },
      { code: 'AIRTEL_MONEY', label: 'Airtel Money (Niger)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'MOOV_MONEY', label: 'Moov Money (Niger)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'ORANGE_MONEY', label: 'Orange Money (Niger)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'BANK_TRANSFER', label: 'Virement bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
      { code: 'CARD', label: 'Carte bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
    ],
  },
  CM: {
    code: 'CM',
    name: 'Cameroun',
    flag: '🇨🇲',
    currency: 'XAF',
    timezone: 'Africa/Douala',
    methods: [
      { code: 'CASH', label: 'Espèces', enabled: true, requireReference: false, affectsCashDrawer: true },
      { code: 'ORANGE_MONEY', label: 'Orange Money (CM)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'MTN_MOMO', label: 'MTN MoMo (CM)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'BANK_TRANSFER', label: 'Virement bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
      { code: 'CARD', label: 'Carte bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
    ],
  },
  GA: {
    code: 'GA',
    name: 'Gabon',
    flag: '🇬🇦',
    currency: 'XAF',
    timezone: 'Africa/Libreville',
    methods: [
      { code: 'CASH', label: 'Espèces', enabled: true, requireReference: false, affectsCashDrawer: true },
      { code: 'AIRTEL_MONEY', label: 'Airtel Money (Gabon)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'MOOV_MONEY', label: 'Moov Money (Gabon)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'BANK_TRANSFER', label: 'Virement bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
      { code: 'CARD', label: 'Carte bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
    ],
  },
  CD: {
    code: 'CD',
    name: 'RDC',
    flag: '🇨🇩',
    currency: 'USD',
    timezone: 'Africa/Kinshasa',
    methods: [
      { code: 'CASH', label: 'Espèces', enabled: true, requireReference: false, affectsCashDrawer: true },
      { code: 'MPESA', label: 'M-Pesa (Vodacom)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'ORANGE_MONEY', label: 'Orange Money (RDC)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'AIRTEL_MONEY', label: 'Airtel Money (RDC)', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'BANK_TRANSFER', label: 'Virement bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
      { code: 'CARD', label: 'Carte bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
    ],
  },
  OTHER: {
    code: 'OTHER',
    name: 'Autre / International',
    flag: '🌍',
    currency: 'XOF',
    timezone: 'Africa/Bamako',
    methods: [
      { code: 'CASH', label: 'Espèces', enabled: true, requireReference: false, affectsCashDrawer: true },
      { code: 'ORANGE_MONEY', label: 'Orange Money', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'WAVE', label: 'Wave', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'MOOV_MONEY', label: 'Moov Money', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'MTN_MOMO', label: 'MTN MoMo', enabled: false, requireReference: false, affectsCashDrawer: false },
      { code: 'CARD', label: 'Carte bancaire', enabled: true, requireReference: false, affectsCashDrawer: false },
      { code: 'BANK_TRANSFER', label: 'Virement bancaire', enabled: false, requireReference: false, affectsCashDrawer: false },
    ],
  },
};

export const COUNTRY_OPTIONS = Object.values(COUNTRY_PRESETS);

export function detectCountryFromTimezone(timezone?: string): string {
  if (!timezone) return 'ML';
  const tz = timezone.toLowerCase();
  if (tz.includes('bamako')) return 'ML';
  if (tz.includes('dakar')) return 'SN';
  if (tz.includes('abidjan')) return 'CI';
  if (tz.includes('ouagadougou')) return 'BF';
  if (tz.includes('conakry')) return 'GN';
  if (tz.includes('lome')) return 'TG';
  if (tz.includes('porto-novo') || tz.includes('cotonou')) return 'BJ';
  if (tz.includes('niamey')) return 'NE';
  if (tz.includes('douala')) return 'CM';
  if (tz.includes('libreville')) return 'GA';
  if (tz.includes('kinshasa') || tz.includes('lubumbashi')) return 'CD';
  return 'OTHER';
}

export function getPaymentMethodsForTimezone(timezone?: string): PaymentMethodConfig[] {
  const code = detectCountryFromTimezone(timezone);
  return COUNTRY_PRESETS[code]?.methods || COUNTRY_PRESETS.ML.methods;
}

export const DEFAULT_PAYMENT_METHODS: PaymentMethodConfig[] = COUNTRY_PRESETS.ML.methods;

export const dayHoursSchema = z.object({
  open: timeHHmmSchema,
  close: timeHHmmSchema,
  closed: z.boolean(),
});

export const openingHoursSchema = z.object({
  mon: dayHoursSchema,
  tue: dayHoursSchema,
  wed: dayHoursSchema,
  thu: dayHoursSchema,
  fri: dayHoursSchema,
  sat: dayHoursSchema,
  sun: dayHoursSchema,
});

export type OpeningHoursConfig = z.infer<typeof openingHoursSchema>;

export const DEFAULT_OPENING_HOURS: OpeningHoursConfig = {
  mon: { open: '08:00', close: '20:00', closed: false },
  tue: { open: '08:00', close: '20:00', closed: false },
  wed: { open: '08:00', close: '20:00', closed: false },
  thu: { open: '08:00', close: '20:00', closed: false },
  fri: { open: '08:00', close: '20:00', closed: false },
  sat: { open: '09:00', close: '20:00', closed: false },
  sun: { open: '09:00', close: '14:00', closed: true },
};

export const loginSchema = z.object({
  email: z.string().trim().email('Adresse e-mail invalide.').toLowerCase(),
  password: z.string().min(1, 'Le mot de passe est obligatoire.'),
  deviceName: z.string().trim().max(100).optional(),
});

export const verifyTwoFactorLoginSchema = z.object({
  challengeToken: z.string().min(10, 'Jeton de vérification manquant.'),
  code: z.string().trim().regex(/^\d{6}$/, 'Le code 2FA doit contenir 6 chiffres.'),
  deviceName: z.string().trim().max(100).optional(),
});

export const confirmTwoFactorSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Le code 2FA doit contenir 6 chiffres.'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Le mot de passe actuel est requis.'),
  newPassword: strongPasswordSchema,
});

export const SUBSCRIPTION_PAYMENT_METHODS = [
  'ORANGE_MONEY',
  'WAVE',
  'MOOV_MONEY',
  'CASH',
  'BANK_TRANSFER',
] as const;
export type SubscriptionPaymentMethod = (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];

export const SUBSCRIPTION_PAYMENT_METHOD_LABELS: Record<SubscriptionPaymentMethod, string> = {
  ORANGE_MONEY: 'Orange Money',
  WAVE: 'Wave',
  MOOV_MONEY: 'Moov Money',
  CASH: 'Espèces (Paiement agent)',
  BANK_TRANSFER: 'Virement / Dépôt bancaire',
};

export const registerMerchantSchema = z.object({
  // Propriétaire
  ownerFullName: z.string().trim().min(2, 'Votre nom complet est requis.').max(120),
  ownerEmail: z.string().trim().email('Adresse e-mail invalide.').toLowerCase(),
  ownerPhone: z.string().trim().min(6, 'Numéro de téléphone invalide.').max(30),
  ownerPassword: strongPasswordSchema,
  // Entreprise & Boutique
  merchantName: z.string().trim().min(2).max(120).optional(),
  legalName: z.string().trim().max(160).optional(),
  shopName: z.string().trim().min(2, 'Le nom de votre boutique est requis.').max(120),
  shopSlug: slugSchema.optional(),
  shopType: z.enum(SHOP_TYPES).default('GROCERY'),
  enabledShopTypes: z.array(z.enum(SHOP_TYPES)).min(1).optional(),
  logoUrl: z.string().trim().max(500).nullable().optional(),
  slogan: z.string().trim().max(160).optional(),
  shopAddress: z.string().trim().max(255).optional(),
  shopPhone: z.string().trim().max(30).optional(),
  currency: z.string().trim().min(3).max(5).default(DEFAULT_CURRENCY),
  defaultTimezone: z.string().trim().min(3).max(60).default(DEFAULT_TIMEZONE),
  // Protection Honeypot anti-bot
  websiteHp: z.string().trim().max(100).optional(),
  // Modes d'encaissement acceptés en boutique (POS & Vitrine)
  shopPaymentMethodCodes: z
    .array(z.enum(['CASH', 'ORANGE_MONEY', 'WAVE', 'MOOV_MONEY', 'CARD']))
    .min(1, 'Sélectionnez au moins un mode d’encaissement en boutique.')
    .default(['CASH', 'ORANGE_MONEY', 'WAVE']),
  // Formule & Mode de paiement de l'abonnement
  planCode: z.enum(SUBSCRIPTION_PLANS).default('PRO'),
  billingCycle: z.enum(SUBSCRIPTION_BILLING_CYCLES).default('MONTHLY'),
  startFreeTrial: z.boolean().default(true),
  subscriptionPaymentMethod: z.enum(SUBSCRIPTION_PAYMENT_METHODS).default('ORANGE_MONEY'),
  subscriptionPaymentReference: z.string().trim().max(120).optional(),
  deviceName: z.string().trim().max(100).optional(),
});

export type RegisterMerchantInput = z.infer<typeof registerMerchantSchema>;

export const createMerchantSchema = z.object({
  merchantName: z.string().trim().min(2, 'Le nom du marchand est requis.').max(120),
  legalName: z.string().trim().max(160).optional(),
  phone: z.string().trim().min(6, 'Numéro de téléphone invalide.').max(30),
  email: z.string().trim().email('Adresse e-mail entreprise invalide.').toLowerCase(),
  currency: z.string().trim().min(3).max(5).default(DEFAULT_CURRENCY),
  defaultTimezone: z.string().trim().min(3).max(60).default(DEFAULT_TIMEZONE),
  ownerFullName: z.string().trim().min(2, 'Le nom du propriétaire est requis.').max(120),
  ownerEmail: z.string().trim().email('Adresse e-mail du propriétaire invalide.').toLowerCase(),
  ownerPhone: z.string().trim().min(6).max(30).optional(),
  ownerPassword: strongPasswordSchema,
  initialShopName: z.string().trim().min(2).max(120).optional(),
  initialShopSlug: slugSchema.optional(),
  initialShopType: z.enum(SHOP_TYPES).optional(),
  initialShopTypes: z.array(z.enum(SHOP_TYPES)).optional(),
});

export const adminCreateShopSchema = z.object({
  merchantId: z.string().uuid('Marchand requis.'),
  name: z.string().trim().min(2, 'Le nom de la boutique est requis.').max(120),
  slug: slugSchema.optional(),
  shopType: z.enum(SHOP_TYPES).default('GENERAL'),
  enabledShopTypes: z.array(z.enum(SHOP_TYPES)).optional(),
});

export const adminUpdateShopTypesSchema = z.object({
  shopType: z.enum(SHOP_TYPES),
  enabledShopTypes: z.array(z.enum(SHOP_TYPES)).min(1).optional(),
  seedCategories: z.boolean().default(true),
});

export const requestShopTypeExpansionSchema = z.object({
  requestedShopType: z.enum(SHOP_TYPES),
  message: z.string().trim().max(400).optional(),
});

export const updateTenantStatusSchema = z.object({
  status: z.enum(TENANT_STATUSES),
  reason: z.string().trim().min(5, 'Un motif d’au moins 5 caractères est obligatoire.').max(500),
  gracePeriodEndsAt: z.string().datetime().nullable().optional(),
});

export const createSupportAccessSchema = z.object({
  merchantId: z.string().uuid('Identifiant marchand invalide.'),
  reason: z.string().trim().min(10, 'Veuillez préciser un motif détaillé (au moins 10 caractères).').max(500),
  durationMinutes: z.number().int().min(15).max(120).default(60),
  readOnly: z.boolean().default(true),
});

export const updateMerchantSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legalName: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().min(6).max(30).optional(),
  email: z.string().trim().email().toLowerCase().optional(),
  defaultTimezone: z.string().trim().min(3).max(60).optional(),
});

export const createShopSchema = z.object({
  name: z.string().trim().min(2, 'Le nom de la boutique est requis.').max(120),
  slug: slugSchema.optional(),
  shopType: z.enum(SHOP_TYPES).default('GENERAL'),
  businessProfile: businessProfileSchema.partial().optional(),
  logoUrl: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email('E-mail boutique invalide.').toLowerCase().optional().or(z.literal('')),
  address: z.string().trim().max(255).optional(),
  currency: z.string().trim().min(3).max(5).default(DEFAULT_CURRENCY),
  timezone: z.string().trim().min(3).max(60).default(DEFAULT_TIMEZONE),
  dailyReportTime: timeHHmmSchema.default(DEFAULT_DAILY_REPORT_TIME),
  taxMode: z.enum(TAX_MODES).default('NONE'),
  defaultTaxRateBps: z.number().int().min(0).max(5000).default(0),
  requireOperatorPin: z.boolean().default(false),
  openingHours: openingHoursSchema.optional(),
  paymentMethods: z.array(paymentMethodConfigSchema).min(1).optional(),
  deliveryConfig: deliveryConfigSchema.partial().optional(),
  receiptSettings: receiptSettingsSchema.partial().optional(),
});

export const updateShopSchema = createShopSchema.partial();

const permissionsRecordSchema = z.record(z.enum(PERMISSION_KEYS), z.boolean());

export const createAgentSchema = z.object({
  fullName: z.string().trim().min(2, 'Le libellé du compte Agent est requis.').max(120),
  email: z.string().trim().email('Adresse e-mail invalide.').toLowerCase(),
  phone: z.string().trim().max(30).optional(),
  password: strongPasswordSchema,
  permissions: permissionsRecordSchema.optional(),
  maxDiscountPercent: z.number().int().min(0).max(100).default(0),
  maxExpenseAmountXof: z.number().int().min(0).max(100000000).default(0),
});

export const updateAgentSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  isActive: z.boolean().optional(),
  permissions: permissionsRecordSchema.optional(),
  maxDiscountPercent: z.number().int().min(0).max(100).optional(),
  maxExpenseAmountXof: z.number().int().min(0).max(100000000).optional(),
});

export const resetAgentPasswordSchema = z.object({
  newPassword: strongPasswordSchema,
});

export const operatorPinSchema = z
  .string()
  .trim()
  .regex(/^\d{4,6}$/, 'Le code PIN doit contenir entre 4 et 6 chiffres.');

export const createOperatorSchema = z.object({
  firstName: z.string().trim().min(2, 'Le prénom de l’opérateur est requis.').max(60),
  pin: operatorPinSchema.optional().or(z.literal('')),
});

export const updateOperatorSchema = z.object({
  firstName: z.string().trim().min(2).max(60).optional(),
  pin: operatorPinSchema.nullable().optional().or(z.literal('')),
  isActive: z.boolean().optional(),
});

export const verifyOperatorPinSchema = z.object({
  operatorId: z.string().uuid('Opérateur invalide.'),
  pin: operatorPinSchema,
});

export const registerTerminalSchema = z.object({
  deviceUid: z.string().trim().min(8).max(120),
  label: z.string().trim().min(2).max(80),
});
