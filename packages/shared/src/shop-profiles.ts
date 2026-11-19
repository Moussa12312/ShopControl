import { z } from 'zod';

export const SHOP_TYPES = [
  'FASHION',
  'GROCERY',
  'COSMETICS',
  'ELECTRONICS',
  'GENERAL',
] as const;
export type ShopType = (typeof SHOP_TYPES)[number];

export const STOREFRONT_LAYOUTS = ['GALLERY', 'QUICK_LIST', 'TECH_SPEC'] as const;
export type StorefrontLayout = (typeof STOREFRONT_LAYOUTS)[number];

export const SHOP_TYPE_LABELS: Record<ShopType, string> = {
  FASHION: 'Mode, Vêtements & Chaussures',
  GROCERY: 'Boutique de quartier & Alimentation',
  COSMETICS: 'Cosmétique, Beauté & Parapharmacie',
  ELECTRONICS: 'Électronique, Téléphonie & Quincaillerie',
  GENERAL: 'Commerce général / Multi-rayons',
};

export const SHOP_TYPE_SHORT_LABELS: Record<ShopType, string> = {
  FASHION: 'Mode & Vêtements',
  GROCERY: 'Alimentation / Quartier',
  COSMETICS: 'Cosmétique',
  ELECTRONICS: 'Électronique',
  GENERAL: 'Général',
};

export const SHOP_TYPE_DESCRIPTIONS: Record<ShopType, string> = {
  FASHION:
    'Galerie jusqu’à 10 photos, sélection Tailles & Couleurs, vitrine Lookbook visuelle.',
  GROCERY:
    'Saisie ultra-rapide, Gros ↔ Détail (carton/sac), vente au montant (ex. 250 F de sucre), dates de péremption (DLC), POS express & vitrine liste rapide.',
  COSMETICS:
    'Marque & contenance (ml/g), galerie photos, suivi des dates de péremption (DLC) & alertes.',
  ELECTRONICS:
    'Marque, modèle, suivi Numéro de série / IMEI, garantie imprimée sur ticket & vitrine fiche technique.',
  GENERAL:
    'Profil polyvalent : activez à la carte uniquement les options utiles à votre boutique.',
};

export const STOREFRONT_LAYOUT_LABELS: Record<StorefrontLayout, string> = {
  GALLERY: 'Galerie Lookbook (cartes visuelles)',
  QUICK_LIST: 'Épicerie Express (liste rapide - / +)',
  TECH_SPEC: 'Catalogue Technique (marque & garantie)',
};

export const businessProfileSchema = z.object({
  enableSizes: z.boolean().default(false),
  enableColors: z.boolean().default(false),
  enableMultiPhotos: z.boolean().default(true),
  enableBulkUnits: z.boolean().default(false),
  enableAmountSale: z.boolean().default(false),
  enableExpiryTracking: z.boolean().default(false),
  enableSerialWarranty: z.boolean().default(false),
  enableBrandModel: z.boolean().default(false),
  enableFastPosFavorites: z.boolean().default(false),
  storefrontLayout: z.enum(STOREFRONT_LAYOUTS).default('GALLERY'),
  defaultUnits: z.array(z.string().trim().min(1).max(24)).max(15).default(['unité']),
});

export type BusinessProfileConfig = z.infer<typeof businessProfileSchema>;

export const SHOP_TYPE_PRESETS: Record<ShopType, BusinessProfileConfig> = {
  FASHION: {
    enableSizes: true,
    enableColors: true,
    enableMultiPhotos: true,
    enableBulkUnits: false,
    enableAmountSale: false,
    enableExpiryTracking: false,
    enableSerialWarranty: false,
    enableBrandModel: true,
    enableFastPosFavorites: false,
    storefrontLayout: 'GALLERY',
    defaultUnits: ['pièce', 'paire', 'ensemble', 'mètre', 'unité'],
  },
  GROCERY: {
    enableSizes: false,
    enableColors: false,
    enableMultiPhotos: false,
    enableBulkUnits: true,
    enableAmountSale: true,
    enableExpiryTracking: true,
    enableSerialWarranty: false,
    enableBrandModel: false,
    enableFastPosFavorites: true,
    storefrontLayout: 'QUICK_LIST',
    defaultUnits: ['unité', 'sachet', 'boîte', 'kg', 'L', 'paquet', 'bouteille', 'pot'],
  },
  COSMETICS: {
    enableSizes: false,
    enableColors: true,
    enableMultiPhotos: true,
    enableBulkUnits: true,
    enableAmountSale: false,
    enableExpiryTracking: true,
    enableSerialWarranty: false,
    enableBrandModel: true,
    enableFastPosFavorites: false,
    storefrontLayout: 'GALLERY',
    defaultUnits: ['flacon', 'tube', 'pot', 'boîte', 'unité', 'pack'],
  },
  ELECTRONICS: {
    enableSizes: false,
    enableColors: true,
    enableMultiPhotos: true,
    enableBulkUnits: false,
    enableAmountSale: false,
    enableExpiryTracking: false,
    enableSerialWarranty: true,
    enableBrandModel: true,
    enableFastPosFavorites: false,
    storefrontLayout: 'TECH_SPEC',
    defaultUnits: ['pièce', 'kit', 'pack', 'unité'],
  },
  GENERAL: {
    enableSizes: true,
    enableColors: true,
    enableMultiPhotos: true,
    enableBulkUnits: true,
    enableAmountSale: false,
    enableExpiryTracking: false,
    enableSerialWarranty: false,
    enableBrandModel: false,
    enableFastPosFavorites: true,
    storefrontLayout: 'GALLERY',
    defaultUnits: ['unité', 'pièce', 'boîte', 'paquet', 'kg', 'L'],
  },
};

export const SHOP_TYPE_SUGGESTED_CATEGORIES: Record<ShopType, string[]> = {
  FASHION: ['Hauts & Chemises', 'Pantalons & Robes', 'Chaussures', 'Bazin & Traditionnel', 'Accessoires'],
  GROCERY: ['Sucre, Riz & Céréales', 'Lait & Produits laitiers', 'Huiles & Condiments', 'Boissons & Eau', 'Hygiène & Savons', 'Biscuits & Confiserie'],
  COSMETICS: ['Soins Visage', 'Soins Corps & Cheveux', 'Parfums', 'Maquillage', 'Hygiène'],
  ELECTRONICS: ['Smartphones', 'Accessoires & Chargeurs', 'Audio & Écouteurs', 'Informatique', 'Électroménager'],
  GENERAL: ['Articles courants', 'Nouveautés', 'Promotions'],
};

export function normalizeShopType(raw: unknown): ShopType {
  if (typeof raw === 'string' && (SHOP_TYPES as readonly string[]).includes(raw)) {
    return raw as ShopType;
  }
  return 'GENERAL';
}

export function normalizeBusinessProfile(
  shopType: unknown,
  rawProfile?: unknown,
): BusinessProfileConfig {
  const safeType = normalizeShopType(shopType);
  const preset = SHOP_TYPE_PRESETS[safeType];
  if (!rawProfile || typeof rawProfile !== 'object') {
    return { ...preset, defaultUnits: [...preset.defaultUnits] };
  }
  const obj = rawProfile as Partial<BusinessProfileConfig>;
  return {
    enableSizes: typeof obj.enableSizes === 'boolean' ? obj.enableSizes : preset.enableSizes,
    enableColors: typeof obj.enableColors === 'boolean' ? obj.enableColors : preset.enableColors,
    enableMultiPhotos:
      typeof obj.enableMultiPhotos === 'boolean' ? obj.enableMultiPhotos : preset.enableMultiPhotos,
    enableBulkUnits:
      typeof obj.enableBulkUnits === 'boolean' ? obj.enableBulkUnits : preset.enableBulkUnits,
    enableAmountSale:
      typeof obj.enableAmountSale === 'boolean' ? obj.enableAmountSale : preset.enableAmountSale,
    enableExpiryTracking:
      typeof obj.enableExpiryTracking === 'boolean'
        ? obj.enableExpiryTracking
        : preset.enableExpiryTracking,
    enableSerialWarranty:
      typeof obj.enableSerialWarranty === 'boolean'
        ? obj.enableSerialWarranty
        : preset.enableSerialWarranty,
    enableBrandModel:
      typeof obj.enableBrandModel === 'boolean' ? obj.enableBrandModel : preset.enableBrandModel,
    enableFastPosFavorites:
      typeof obj.enableFastPosFavorites === 'boolean'
        ? obj.enableFastPosFavorites
        : preset.enableFastPosFavorites,
    storefrontLayout:
      typeof obj.storefrontLayout === 'string' &&
      (STOREFRONT_LAYOUTS as readonly string[]).includes(obj.storefrontLayout)
        ? (obj.storefrontLayout as StorefrontLayout)
        : preset.storefrontLayout,
    defaultUnits:
      Array.isArray(obj.defaultUnits) && obj.defaultUnits.length > 0
        ? obj.defaultUnits.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        : [...preset.defaultUnits],
  };
}
