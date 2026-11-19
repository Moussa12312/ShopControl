import { z } from 'zod';

export const SHOP_TYPES = [
  'FASHION',
  'GROCERY',
  'COSMETICS',
  'HARDWARE',
  'ELECTRONICS',
  'AUTOMOTIVE',
  'GENERAL',
] as const;
export type ShopType = (typeof SHOP_TYPES)[number];

export const STOREFRONT_LAYOUTS = ['GALLERY', 'QUICK_LIST', 'TECH_SPEC'] as const;
export type StorefrontLayout = (typeof STOREFRONT_LAYOUTS)[number];

export const SHOP_TYPE_LABELS: Record<ShopType, string> = {
  FASHION: 'Mode, Vêtements, Chaussures & Accessoires',
  GROCERY: 'Boutique de rue & Alimentation générale',
  COSMETICS: 'Cosmétique, Beauté, Hygiène & Parfumerie',
  HARDWARE: 'Quincaillerie, Matériaux BTP & Outillage',
  ELECTRONICS: 'Électronique, Téléphonie, Info & Électroménager',
  AUTOMOTIVE: 'Véhicules, Motos, Pièces Auto & Lubrifiants',
  GENERAL: 'Commerce général / Multi-rayons',
};

export const SHOP_TYPE_SHORT_LABELS: Record<ShopType, string> = {
  FASHION: 'Mode & Vêtements',
  GROCERY: 'Boutique de rue / Alimentation',
  COSMETICS: 'Cosmétique & Hygiène',
  HARDWARE: 'Quincaillerie & BTP',
  ELECTRONICS: 'Électronique & Téléphonie',
  AUTOMOTIVE: 'Auto, Moto & Pièces',
  GENERAL: 'Multi-rayons',
};

export const SHOP_TYPE_DESCRIPTIONS: Record<ShopType, string> = {
  FASHION:
    'Habits (tailles XS-3XL), chaussures (pointures 36-46), tissus/bazin au mètre, montres, lunettes, casquettes & sacs.',
  GROCERY:
    'Mix boutique de rue : céréales/sucre au kg & au montant (ex: 250 F), huiles au litre, lait/conserves à la boîte & au carton, boissons & hygiène.',
  COSMETICS:
    'Pommades, laits, crèmes & shampoings (ml/g + DLC), parfums, maquillage/mèches (teintes & longueurs), brosses à dents & savons (pièce / douzaine).',
  HARDWARE:
    'Matériaux (ciment/fer/carreaux en sac/tonne/barre/m²), câbles & tuyaux à la coupe au mètre, visserie/clous au kg ou boîte, outillage & machines.',
  ELECTRONICS:
    'Téléphones, tablettes & ordinateurs (Marque, Modèle/Go, IMEI obligatoire & Garantie), TV/électroménager/solaire & accessoires tech.',
  AUTOMOTIVE:
    'Voitures, motos & tricycles (Marque, Modèle/Année, N° Châssis VIN & Garantie), pièces détachées, pneus, batteries & huiles moteur.',
  GENERAL:
    'Débloque toutes les familles de catégories pour les boutiques multi-activités.',
};

export const STOREFRONT_LAYOUT_LABELS: Record<StorefrontLayout, string> = {
  GALLERY: 'Galerie Lookbook (cartes visuelles)',
  QUICK_LIST: 'Épicerie Express (liste rapide - / +)',
  TECH_SPEC: 'Catalogue Technique (marque & garantie)',
};

// ============================================================================
// MODES DE VENTE PAR CATÉGORIE (Pilote 100 % la boîte « Nouveau produit »)
// ============================================================================

export const CATEGORY_SELLING_MODES = [
  'WEIGHT_BULK',
  'VOLUME_BULK',
  'PIECE_CARTON_DLC',
  'PIECE_CARTON',
  'COSMETIC_CARE',
  'COSMETIC_SHADE',
  'APPAREL_SIZE_COLOR',
  'FOOTWEAR_SHOE_COLOR',
  'FABRIC_METER_COLOR',
  'FASHION_ACCESSORY',
  'HARDWARE_MATERIAL',
  'HARDWARE_CUT_METER',
  'TECH_SERIAL_WARRANTY',
  'VEHICLE_VIN_WARRANTY',
  'AUTO_PART',
  'STANDARD_PIECE',
] as const;

export type CategorySellingMode = (typeof CATEGORY_SELLING_MODES)[number];

export interface CategorySellingModeSpec {
  code: CategorySellingMode;
  label: string;
  shortLabel: string;
  description: string;
  shopTypes: ShopType[];
  defaultUnit: string;
  suggestedUnits: string[];
  defaultBulkUnitLabel: string | null;
  // Champs affichés dans la boîte « Nouveau produit » (Zéro mélange)
  multiPhotos: boolean;
  sizeMode: 'NONE' | 'CLOTHING' | 'SHOES' | 'CUSTOM';
  showColors: boolean;
  showBrand: boolean;
  showModel: boolean;
  modelLabel?: string;
  modelPlaceholder?: string;
  showVolumeDimension: boolean;
  volumeLabelTitle?: string;
  volumePlaceholder?: string;
  showBulkPackaging: boolean;
  showAmountFractionalSale: boolean;
  defaultAllowFractionalSale: boolean;
  showExpiryDlc: boolean;
  showWarranty: boolean;
  showSerialNumber: boolean;
  serialRequiredByDefault: boolean;
  serialLabel?: string;
  showPosFavoriteToggle: boolean;
}

export const CATEGORY_SELLING_MODE_SPECS: Record<CategorySellingMode, CategorySellingModeSpec> = {
  WEIGHT_BULK: {
    code: 'WEIGHT_BULK',
    label: 'Vente au Poids (kg / g) + Sac (Gros) + Vente au montant (ex: 250 F)',
    shortLabel: 'Au Poids (kg) · Sac · Montant',
    description: 'Sucre, riz, farine, mil, sel, haricot, arachide… Vendu au kg, en sac ou au montant libre.',
    shopTypes: ['GROCERY', 'GENERAL'],
    defaultUnit: 'kg',
    suggestedUnits: ['kg', 'g', 'sachet', 'pot'],
    defaultBulkUnitLabel: 'sac',
    multiPhotos: false,
    sizeMode: 'NONE',
    showColors: false,
    showBrand: false,
    showModel: false,
    showVolumeDimension: false,
    showBulkPackaging: true,
    showAmountFractionalSale: true,
    defaultAllowFractionalSale: true,
    showExpiryDlc: false,
    showWarranty: false,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: true,
  },
  VOLUME_BULK: {
    code: 'VOLUME_BULK',
    label: 'Vente au Litre (L / bouteille) + Bidon (Gros) + Vente au montant',
    shortLabel: 'Au Litre (L) · Bidon · Montant',
    description: 'Huile alimentaire, lait liquide, miel, vinaigre… Vendu au litre, en bidon ou au montant libre.',
    shopTypes: ['GROCERY', 'GENERAL'],
    defaultUnit: 'L',
    suggestedUnits: ['L', 'bouteille', 'sachet', 'cl'],
    defaultBulkUnitLabel: 'bidon',
    multiPhotos: false,
    sizeMode: 'NONE',
    showColors: false,
    showBrand: false,
    showModel: false,
    showVolumeDimension: false,
    showBulkPackaging: true,
    showAmountFractionalSale: true,
    defaultAllowFractionalSale: true,
    showExpiryDlc: true,
    showWarranty: false,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: true,
  },
  PIECE_CARTON_DLC: {
    code: 'PIECE_CARTON_DLC',
    label: 'À la Boîte / Sachet / Bouteille + Carton/Pack (Gros) + Péremption (DLC)',
    shortLabel: 'Boîte/Bouteille · Carton · DLC',
    description: 'Lait en boîte, sardines, pâtes, tomate, cubes, biscuits, eau, jus, sodas, yaourts, œufs.',
    shopTypes: ['GROCERY', 'GENERAL'],
    defaultUnit: 'boîte',
    suggestedUnits: ['boîte', 'sachet', 'bouteille', 'paquet', 'pot', 'pièce', 'alvéole'],
    defaultBulkUnitLabel: 'carton',
    multiPhotos: false,
    sizeMode: 'NONE',
    showColors: false,
    showBrand: false,
    showModel: false,
    showVolumeDimension: false,
    showBulkPackaging: true,
    showAmountFractionalSale: false,
    defaultAllowFractionalSale: false,
    showExpiryDlc: true,
    showWarranty: false,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: true,
  },
  PIECE_CARTON: {
    code: 'PIECE_CARTON',
    label: 'À la Pièce / Paquet + Douzaine / Carton (Gros)',
    shortLabel: 'Pièce / Paquet · Douzaine / Carton',
    description: 'Brosses à dents, savons, lessive OMO, javel, piles, visserie, fournitures.',
    shopTypes: ['GROCERY', 'COSMETICS', 'HARDWARE', 'GENERAL'],
    defaultUnit: 'pièce',
    suggestedUnits: ['pièce', 'paquet', 'sachet', 'boîte', 'kg'],
    defaultBulkUnitLabel: 'douzaine',
    multiPhotos: false,
    sizeMode: 'NONE',
    showColors: false,
    showBrand: true,
    showModel: false,
    showVolumeDimension: false,
    showBulkPackaging: true,
    showAmountFractionalSale: false,
    defaultAllowFractionalSale: false,
    showExpiryDlc: false,
    showWarranty: false,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: true,
  },
  COSMETIC_CARE: {
    code: 'COSMETIC_CARE',
    label: 'Flacon / Pot / Tube avec Marque, Contenance (ml / g), DLC & Douzaine',
    shortLabel: 'Flacon/Pot · ml/g · DLC · Douzaine',
    description: 'Pommades, laits corporels, crèmes visage, huiles, shampoings, parfums, déodorants.',
    shopTypes: ['COSMETICS', 'GENERAL'],
    defaultUnit: 'flacon',
    suggestedUnits: ['flacon', 'pot', 'tube', 'boîte', 'pièce'],
    defaultBulkUnitLabel: 'douzaine',
    multiPhotos: true,
    sizeMode: 'NONE',
    showColors: false,
    showBrand: true,
    showModel: false,
    showVolumeDimension: true,
    volumeLabelTitle: 'Contenance / Format (ml, g, cl)',
    volumePlaceholder: 'Ex. 250 ml, 500 g, 100 ml…',
    showBulkPackaging: true,
    showAmountFractionalSale: false,
    defaultAllowFractionalSale: false,
    showExpiryDlc: true,
    showWarranty: false,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: false,
  },
  COSMETIC_SHADE: {
    code: 'COSMETIC_SHADE',
    label: 'Maquillage, Mèches & Perruques (Marque, Teintes/Couleurs & Longueur)',
    shortLabel: 'Pièce · Teintes/Couleurs · Longueur',
    description: 'Rouge à lèvres, fond de teint, vernis, mèches, perruques, tissages.',
    shopTypes: ['COSMETICS', 'FASHION', 'GENERAL'],
    defaultUnit: 'pièce',
    suggestedUnits: ['pièce', 'paquet', 'boîte'],
    defaultBulkUnitLabel: 'douzaine',
    multiPhotos: true,
    sizeMode: 'CUSTOM',
    showColors: true,
    showBrand: true,
    showModel: false,
    showVolumeDimension: false,
    showBulkPackaging: true,
    showAmountFractionalSale: false,
    defaultAllowFractionalSale: false,
    showExpiryDlc: false,
    showWarranty: false,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: false,
  },
  APPAREL_SIZE_COLOR: {
    code: 'APPAREL_SIZE_COLOR',
    label: 'Vêtements & Habits (Pièce, Tailles XS à 3XL, Couleurs & Galerie photos)',
    shortLabel: 'Pièce · Tailles XS-3XL · Couleurs',
    description: 'Chemises, pantalons, robes, boubous, costumes, t-shirts, vestes, habits enfants.',
    shopTypes: ['FASHION', 'GENERAL'],
    defaultUnit: 'pièce',
    suggestedUnits: ['pièce', 'ensemble'],
    defaultBulkUnitLabel: null,
    multiPhotos: true,
    sizeMode: 'CLOTHING',
    showColors: true,
    showBrand: true,
    showModel: false,
    showVolumeDimension: false,
    showBulkPackaging: false,
    showAmountFractionalSale: false,
    defaultAllowFractionalSale: false,
    showExpiryDlc: false,
    showWarranty: false,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: false,
  },
  FOOTWEAR_SHOE_COLOR: {
    code: 'FOOTWEAR_SHOE_COLOR',
    label: 'Chaussures (Paire, Pointures 36 à 46, Couleurs & Galerie photos)',
    shortLabel: 'Paire · Pointures 36-46 · Couleurs',
    description: 'Baskets, souliers, sandales, talons, mocassins, babouches, bottes.',
    shopTypes: ['FASHION', 'GENERAL'],
    defaultUnit: 'paire',
    suggestedUnits: ['paire'],
    defaultBulkUnitLabel: null,
    multiPhotos: true,
    sizeMode: 'SHOES',
    showColors: true,
    showBrand: true,
    showModel: false,
    showVolumeDimension: false,
    showBulkPackaging: false,
    showAmountFractionalSale: false,
    defaultAllowFractionalSale: false,
    showExpiryDlc: false,
    showWarranty: false,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: false,
  },
  FABRIC_METER_COLOR: {
    code: 'FABRIC_METER_COLOR',
    label: 'Tissus, Bazin & Pagnes (Au Mètre ou Complet + Couleurs)',
    shortLabel: 'Mètre / Complet · Couleurs',
    description: 'Bazin riche, wax, pagnes, tissus au mètre ou en coupon complet.',
    shopTypes: ['FASHION', 'GENERAL'],
    defaultUnit: 'mètre',
    suggestedUnits: ['mètre', 'complet', 'yard'],
    defaultBulkUnitLabel: 'rouleau',
    multiPhotos: true,
    sizeMode: 'NONE',
    showColors: true,
    showBrand: true,
    showModel: false,
    showVolumeDimension: true,
    volumeLabelTitle: 'Coupe / Longueur du complet',
    volumePlaceholder: 'Ex. 3 yards, 5 mètres, 10 mètres…',
    showBulkPackaging: false,
    showAmountFractionalSale: false,
    defaultAllowFractionalSale: false,
    showExpiryDlc: false,
    showWarranty: false,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: false,
  },
  FASHION_ACCESSORY: {
    code: 'FASHION_ACCESSORY',
    label: 'Accessoires Mode (Pièce, Marque & Couleurs — sans tailles)',
    shortLabel: 'Pièce · Marque · Couleurs',
    description: 'Montres, lunettes, casquettes, chapeaux, sacs à main, ceintures, bijoux, portefeuilles.',
    shopTypes: ['FASHION', 'GENERAL'],
    defaultUnit: 'pièce',
    suggestedUnits: ['pièce', 'paire', 'coffret'],
    defaultBulkUnitLabel: null,
    multiPhotos: true,
    sizeMode: 'NONE',
    showColors: true,
    showBrand: true,
    showModel: true,
    modelLabel: 'Modèle / Collection',
    modelPlaceholder: 'Ex. Chronograph, Aviator…',
    showVolumeDimension: false,
    showBulkPackaging: false,
    showAmountFractionalSale: false,
    defaultAllowFractionalSale: false,
    showExpiryDlc: false,
    showWarranty: false,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: false,
  },
  HARDWARE_MATERIAL: {
    code: 'HARDWARE_MATERIAL',
    label: 'Matériaux BTP (Sac / Barre / Pot / m² + Tonne / Botte / Carton + Calibre)',
    shortLabel: 'Sac/Barre/m² · Tonne/Botte · Calibre',
    description: 'Ciment, fer à béton, tôles, carreaux, peinture, plâtre, briques.',
    shopTypes: ['HARDWARE', 'GENERAL'],
    defaultUnit: 'sac',
    suggestedUnits: ['sac', 'barre', 'pot', 'm²', 'feuille', 'pièce'],
    defaultBulkUnitLabel: 'tonne',
    multiPhotos: false,
    sizeMode: 'NONE',
    showColors: false,
    showBrand: true,
    showModel: false,
    showVolumeDimension: true,
    volumeLabelTitle: 'Dimension / Calibre / Poids',
    volumePlaceholder: 'Ex. Fer Ø12, Sac 50 kg, Seau 25 L, 60×60 cm…',
    showBulkPackaging: true,
    showAmountFractionalSale: false,
    defaultAllowFractionalSale: false,
    showExpiryDlc: false,
    showWarranty: false,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: true,
  },
  HARDWARE_CUT_METER: {
    code: 'HARDWARE_CUT_METER',
    label: 'Câbles, Tuyaux & Grillages (Au Mètre / Coupe + Rouleau / Barre)',
    shortLabel: 'Au Mètre · Rouleau/Barre · Coupe',
    description: 'Câbles électriques, tuyaux PVC/PPR, cordes, grillages vendus au mètre ou en rouleau.',
    shopTypes: ['HARDWARE', 'GENERAL'],
    defaultUnit: 'mètre',
    suggestedUnits: ['mètre', 'barre', 'rouleau'],
    defaultBulkUnitLabel: 'rouleau',
    multiPhotos: false,
    sizeMode: 'NONE',
    showColors: false,
    showBrand: true,
    showModel: false,
    showVolumeDimension: true,
    volumeLabelTitle: 'Section / Diamètre',
    volumePlaceholder: 'Ex. 2×2.5 mm², PVC Ø110…',
    showBulkPackaging: true,
    showAmountFractionalSale: true,
    defaultAllowFractionalSale: true,
    showExpiryDlc: false,
    showWarranty: false,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: false,
  },
  TECH_SERIAL_WARRANTY: {
    code: 'TECH_SERIAL_WARRANTY',
    label: 'Appareils Tech, Électroménager & Machines (Marque, Modèle, Garantie & IMEI/Série)',
    shortLabel: 'Pièce · Marque/Modèle · Garantie & IMEI',
    description: 'Téléphones, ordinateurs, tablettes, TV, frigos, clims, panneaux solaires, perceuses.',
    shopTypes: ['ELECTRONICS', 'HARDWARE', 'GENERAL'],
    defaultUnit: 'pièce',
    suggestedUnits: ['pièce', 'kit'],
    defaultBulkUnitLabel: null,
    multiPhotos: true,
    sizeMode: 'NONE',
    showColors: true,
    showBrand: true,
    showModel: true,
    modelLabel: 'Modèle / Capacité / Puissance',
    modelPlaceholder: 'Ex. Galaxy A55 256Go, Core i7 16Go, 55 pouces, 200W…',
    showVolumeDimension: false,
    showBulkPackaging: false,
    showAmountFractionalSale: false,
    defaultAllowFractionalSale: false,
    showExpiryDlc: false,
    showWarranty: true,
    showSerialNumber: true,
    serialRequiredByDefault: true,
    serialLabel: 'Exiger la saisie du N° de série / IMEI lors de la vente POS',
    showPosFavoriteToggle: false,
  },
  VEHICLE_VIN_WARRANTY: {
    code: 'VEHICLE_VIN_WARRANTY',
    label: 'Véhicules, Motos & Engins (Marque, Modèle/Année, Couleur, N° Châssis VIN & Garantie)',
    shortLabel: 'Unité · Marque/Année · N° Châssis VIN',
    description: 'Voitures, 4×4, motos, tricycles (Kata-kata), groupes électrogènes, tracteurs.',
    shopTypes: ['AUTOMOTIVE', 'GENERAL'],
    defaultUnit: 'unité',
    suggestedUnits: ['unité'],
    defaultBulkUnitLabel: null,
    multiPhotos: true,
    sizeMode: 'NONE',
    showColors: true,
    showBrand: true,
    showModel: true,
    modelLabel: 'Modèle / Année / Motorisation',
    modelPlaceholder: 'Ex. Corolla 2022 Essence, Djakarta 125cc…',
    showVolumeDimension: true,
    volumeLabelTitle: 'État / Kilométrage / Cylindrée',
    volumePlaceholder: 'Ex. Neuf 0 km, Occasion 45 000 km…',
    showBulkPackaging: false,
    showAmountFractionalSale: false,
    defaultAllowFractionalSale: false,
    showExpiryDlc: false,
    showWarranty: true,
    showSerialNumber: true,
    serialRequiredByDefault: true,
    serialLabel: 'Exiger la saisie du N° de Châssis (VIN) / N° Moteur à la vente',
    showPosFavoriteToggle: false,
  },
  AUTO_PART: {
    code: 'AUTO_PART',
    label: 'Pièces Auto/Moto, Pneus, Batteries & Lubrifiants (Compatibilité, Format & Garantie)',
    shortLabel: 'Pièce/Bidon · Compatibilité · Garantie',
    description: 'Pneus, batteries, filtres, freins, bougies, huiles moteur (1L, 4L, 5L, carton).',
    shopTypes: ['AUTOMOTIVE', 'GENERAL'],
    defaultUnit: 'pièce',
    suggestedUnits: ['pièce', 'paire', 'bidon', 'L'],
    defaultBulkUnitLabel: 'carton',
    multiPhotos: true,
    sizeMode: 'NONE',
    showColors: false,
    showBrand: true,
    showModel: true,
    modelLabel: 'Véhicule(s) compatible(s) / Référence constructeur',
    modelPlaceholder: 'Ex. Toyota Hilux / Prado, 205/55 R16, 12V 70Ah…',
    showVolumeDimension: true,
    volumeLabelTitle: 'Viscosité / Dimensions / Contenance',
    volumePlaceholder: 'Ex. 5W30 - Bidon 4L, 195/65 R15…',
    showBulkPackaging: true,
    showAmountFractionalSale: false,
    defaultAllowFractionalSale: false,
    showExpiryDlc: false,
    showWarranty: true,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: false,
  },
  STANDARD_PIECE: {
    code: 'STANDARD_PIECE',
    label: 'Article standard à la pièce (Photo, Nom, Description, Prix & Stock)',
    shortLabel: 'Standard à la pièce',
    description: 'Articles courants vendus simplement à l’unité ou par pièce.',
    shopTypes: ['FASHION', 'GROCERY', 'COSMETICS', 'HARDWARE', 'ELECTRONICS', 'AUTOMOTIVE', 'GENERAL'],
    defaultUnit: 'pièce',
    suggestedUnits: ['pièce', 'unité', 'paquet', 'boîte'],
    defaultBulkUnitLabel: null,
    multiPhotos: false,
    sizeMode: 'NONE',
    showColors: false,
    showBrand: true,
    showModel: false,
    showVolumeDimension: false,
    showBulkPackaging: false,
    showAmountFractionalSale: false,
    defaultAllowFractionalSale: false,
    showExpiryDlc: false,
    showWarranty: false,
    showSerialNumber: false,
    serialRequiredByDefault: false,
    showPosFavoriteToggle: false,
  },
};

export interface SuggestedCategoryTemplate {
  name: string;
  sellingMode: CategorySellingMode;
  description: string;
}

export const SHOP_TYPE_CATEGORY_TEMPLATES: Record<ShopType, SuggestedCategoryTemplate[]> = {
  GROCERY: [
    {
      name: 'Céréales, Sucre & Vrac au Poids',
      sellingMode: 'WEIGHT_BULK',
      description: 'Sucre, riz, farine, mil, sel, haricot (au kg, sac ou montant libre ex: 250 F)',
    },
    {
      name: 'Huiles & Liquides au Litre',
      sellingMode: 'VOLUME_BULK',
      description: 'Huile, lait liquide, miel, vinaigre (au litre, bouteille, bidon ou montant)',
    },
    {
      name: 'Lait, Conserves & Épicerie',
      sellingMode: 'PIECE_CARTON_DLC',
      description: 'Lait en boîte/sachet, sardines, pâtes, tomate, cubes Maggi, thé, biscuits',
    },
    {
      name: 'Boissons, Eau & Produits frais',
      sellingMode: 'PIECE_CARTON_DLC',
      description: 'Eau, jus, sodas, yaourts, œufs, beurre (unité, pack, casier ou alvéole)',
    },
    {
      name: 'Hygiène & Entretien maison',
      sellingMode: 'PIECE_CARTON',
      description: 'Brosse à dents, savon, OMO, eau de Javel, piles, papier toilette (pièce / douzaine)',
    },
  ],
  COSMETICS: [
    {
      name: 'Pommades, Laits, Crèmes & Shampoings',
      sellingMode: 'COSMETIC_CARE',
      description: 'Soins corps, visage et cheveux (pot/flacon/tube, contenance ml/g, DLC & douzaine)',
    },
    {
      name: 'Parfums & Déodorants',
      sellingMode: 'COSMETIC_CARE',
      description: 'Parfums, eaux de toilette, déodorants, encens (flacon ml & douzaine)',
    },
    {
      name: 'Maquillage, Mèches & Perruques',
      sellingMode: 'COSMETIC_SHADE',
      description: 'Rouge à lèvres, vernis, fond de teint, mèches & perruques (teintes & longueurs)',
    },
    {
      name: 'Hygiène & Accessoires Beauté',
      sellingMode: 'PIECE_CARTON',
      description: 'Brosses à dents, dentifrice, savons de toilette, couches, cotons (pièce / douzaine)',
    },
  ],
  FASHION: [
    {
      name: 'Vêtements & Habits',
      sellingMode: 'APPAREL_SIZE_COLOR',
      description: 'Chemises, pantalons, robes, boubous, costumes, t-shirts (Tailles XS-3XL & Couleurs)',
    },
    {
      name: 'Chaussures & Sandales',
      sellingMode: 'FOOTWEAR_SHOE_COLOR',
      description: 'Baskets, souliers, sandales, talons, babouches (Pointures 36-46 & Couleurs)',
    },
    {
      name: 'Tissus, Bazin & Pagnes',
      sellingMode: 'FABRIC_METER_COLOR',
      description: 'Bazin riche, wax, tissus au mètre ou en coupon complet + Couleurs',
    },
    {
      name: 'Montres, Lunettes, Casquettes & Sacs',
      sellingMode: 'FASHION_ACCESSORY',
      description: 'Accessoires de mode, sacs, montres, lunettes, casquettes, bijoux (Pièce, Marque & Couleurs)',
    },
  ],
  HARDWARE: [
    {
      name: 'Ciment, Fer, Tôles & Carreaux (Matériaux)',
      sellingMode: 'HARDWARE_MATERIAL',
      description: 'Matériaux de construction vendus par sac/tonne, barre/botte, pot ou m²/carton',
    },
    {
      name: 'Câbles électriques, Tuyaux & Découpe au mètre',
      sellingMode: 'HARDWARE_CUT_METER',
      description: 'Câbles, tuyaux PVC/PPR, grillages vendus au mètre (coupe) ou en rouleau/barre',
    },
    {
      name: 'Visserie, Clous, Serrures & Petites pièces',
      sellingMode: 'PIECE_CARTON',
      description: 'Clous, vis, boulons, cadenas, ampoules, robinets (à la pièce, au kg ou en boîte)',
    },
    {
      name: 'Outillage & Machines',
      sellingMode: 'TECH_SERIAL_WARRANTY',
      description: 'Perceuses, meuleuses, postes à souder, groupes, pompes (Marque, Modèle & Garantie)',
    },
  ],
  ELECTRONICS: [
    {
      name: 'Téléphones, Tablettes & Ordinateurs',
      sellingMode: 'TECH_SERIAL_WARRANTY',
      description: 'Smartphones, PC portables, tablettes (Marque, Modèle/Go, Couleur, IMEI & Garantie)',
    },
    {
      name: 'TV, Électroménager & Solaire',
      sellingMode: 'TECH_SERIAL_WARRANTY',
      description: 'Téléviseurs, frigos, climatiseurs, panneaux solaires, batteries (N° série & Garantie)',
    },
    {
      name: 'Accessoires Téléphonie & Informatique',
      sellingMode: 'FASHION_ACCESSORY',
      description: 'Écouteurs, chargeurs, câbles, coques, clés USB, souris (Pièce, Marque & Couleur)',
    },
  ],
  AUTOMOTIVE: [
    {
      name: 'Voitures, Motos & Tricycles',
      sellingMode: 'VEHICLE_VIN_WARRANTY',
      description: 'Véhicules neufs ou occasion, motos, tricycles (Marque, Modèle/Année, N° Châssis VIN & Garantie)',
    },
    {
      name: 'Pièces détachées, Pneus & Batteries',
      sellingMode: 'AUTO_PART',
      description: 'Pneus, batteries, freins, filtres, amortisseurs (Marque, Compatibilité & Garantie)',
    },
    {
      name: 'Huiles moteur & Lubrifiants',
      sellingMode: 'AUTO_PART',
      description: 'Huiles moteur 1L/4L/5L, liquide de frein, graisse (au bidon, litre ou carton)',
    },
  ],
  GENERAL: [
    {
      name: 'Vêtements & Mode',
      sellingMode: 'APPAREL_SIZE_COLOR',
      description: 'Habits avec tailles XS-3XL et couleurs',
    },
    {
      name: 'Chaussures',
      sellingMode: 'FOOTWEAR_SHOE_COLOR',
      description: 'Chaussures avec pointures 36-46 et couleurs',
    },
    {
      name: 'Alimentation au Poids (Sucre, Riz…)',
      sellingMode: 'WEIGHT_BULK',
      description: 'Vente au kg, en sac ou au montant (ex: 250 F)',
    },
    {
      name: 'Épicerie & Boissons (Unité & Carton)',
      sellingMode: 'PIECE_CARTON_DLC',
      description: 'Vente à la boîte/bouteille ou au carton avec DLC',
    },
    {
      name: 'Cosmétique, Pommades & Parfums',
      sellingMode: 'COSMETIC_CARE',
      description: 'Flacons/pots avec marque, ml/g et DLC',
    },
    {
      name: 'Téléphones, Électronique & Machines',
      sellingMode: 'TECH_SERIAL_WARRANTY',
      description: 'Appareils avec marque, modèle, garantie et N° de série / IMEI',
    },
    {
      name: 'Véhicules & Motos',
      sellingMode: 'VEHICLE_VIN_WARRANTY',
      description: 'Voitures et motos avec marque, modèle/année, couleur et N° Châssis',
    },
  ],
};

export const SHOP_TYPE_SUGGESTED_CATEGORIES: Record<ShopType, string[]> = {
  FASHION: SHOP_TYPE_CATEGORY_TEMPLATES.FASHION.map((c) => c.name),
  GROCERY: SHOP_TYPE_CATEGORY_TEMPLATES.GROCERY.map((c) => c.name),
  COSMETICS: SHOP_TYPE_CATEGORY_TEMPLATES.COSMETICS.map((c) => c.name),
  HARDWARE: SHOP_TYPE_CATEGORY_TEMPLATES.HARDWARE.map((c) => c.name),
  ELECTRONICS: SHOP_TYPE_CATEGORY_TEMPLATES.ELECTRONICS.map((c) => c.name),
  AUTOMOTIVE: SHOP_TYPE_CATEGORY_TEMPLATES.AUTOMOTIVE.map((c) => c.name),
  GENERAL: SHOP_TYPE_CATEGORY_TEMPLATES.GENERAL.map((c) => c.name),
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
  enabledShopTypes: z.array(z.enum(SHOP_TYPES)).optional(),
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
    defaultUnits: ['pièce', 'paire', 'ensemble', 'mètre', 'complet'],
    enabledShopTypes: ['FASHION'],
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
    defaultUnits: ['kg', 'g', 'L', 'boîte', 'sachet', 'bouteille', 'paquet', 'pièce', 'pot'],
    enabledShopTypes: ['GROCERY'],
  },
  COSMETICS: {
    enableSizes: true,
    enableColors: true,
    enableMultiPhotos: true,
    enableBulkUnits: true,
    enableAmountSale: false,
    enableExpiryTracking: true,
    enableSerialWarranty: false,
    enableBrandModel: true,
    enableFastPosFavorites: true,
    storefrontLayout: 'GALLERY',
    defaultUnits: ['flacon', 'pot', 'tube', 'pièce', 'paquet', 'boîte'],
    enabledShopTypes: ['COSMETICS'],
  },
  HARDWARE: {
    enableSizes: false,
    enableColors: false,
    enableMultiPhotos: false,
    enableBulkUnits: true,
    enableAmountSale: true,
    enableExpiryTracking: false,
    enableSerialWarranty: true,
    enableBrandModel: true,
    enableFastPosFavorites: true,
    storefrontLayout: 'QUICK_LIST',
    defaultUnits: ['pièce', 'sac', 'barre', 'mètre', 'm²', 'pot', 'kg', 'rouleau', 'boîte'],
    enabledShopTypes: ['HARDWARE'],
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
    enabledShopTypes: ['ELECTRONICS'],
  },
  AUTOMOTIVE: {
    enableSizes: false,
    enableColors: true,
    enableMultiPhotos: true,
    enableBulkUnits: true,
    enableAmountSale: false,
    enableExpiryTracking: false,
    enableSerialWarranty: true,
    enableBrandModel: true,
    enableFastPosFavorites: false,
    storefrontLayout: 'TECH_SPEC',
    defaultUnits: ['unité', 'pièce', 'paire', 'bidon', 'L'],
    enabledShopTypes: ['AUTOMOTIVE'],
  },
  GENERAL: {
    enableSizes: true,
    enableColors: true,
    enableMultiPhotos: true,
    enableBulkUnits: true,
    enableAmountSale: true,
    enableExpiryTracking: true,
    enableSerialWarranty: true,
    enableBrandModel: true,
    enableFastPosFavorites: true,
    storefrontLayout: 'GALLERY',
    defaultUnits: ['pièce', 'unité', 'boîte', 'paquet', 'kg', 'L', 'mètre'],
    enabledShopTypes: ['GENERAL'],
  },
};

export function normalizeShopType(raw: unknown): ShopType {
  if (typeof raw === 'string' && (SHOP_TYPES as readonly string[]).includes(raw)) {
    return raw as ShopType;
  }
  return 'GENERAL';
}

export function normalizeCategorySellingMode(
  raw: unknown,
  fallbackShopType?: ShopType,
  categoryName?: string,
): CategorySellingMode {
  if (
    typeof raw === 'string' &&
    raw !== 'STANDARD_PIECE' &&
    (CATEGORY_SELLING_MODES as readonly string[]).includes(raw)
  ) {
    return raw as CategorySellingMode;
  }

  // Inférence intelligente par nom de catégorie si sellingMode non encore renseigné
  const lower = (categoryName || '').trim().toLowerCase();
  if (lower) {
    if (/(chaussure|basket|sandale|soulier|pointure|talon|babouche)/.test(lower)) {
      return 'FOOTWEAR_SHOE_COLOR';
    }
    if (/(vêtement|habit|chemise|pantalon|robe|boubou|t-shirt|veste|costume|haut)/.test(lower)) {
      return 'APPAREL_SIZE_COLOR';
    }
    if (/(tissu|bazin|pagne|wax)/.test(lower)) {
      return 'FABRIC_METER_COLOR';
    }
    if (/(montre|lunette|casquette|sac|ceinture|bijou|accessoire mode)/.test(lower)) {
      return 'FASHION_ACCESSORY';
    }
    if (/(sucre|riz|céréale|farine|mil|maïs|sel|haricot|arachide|vrac|poids)/.test(lower)) {
      return 'WEIGHT_BULK';
    }
    if (/(huile|liquide)/.test(lower) && !/(moteur|auto)/.test(lower)) {
      return 'VOLUME_BULK';
    }
    if (/(lait|conserve|sardine|pâte|tomate|boisson|eau|jus|soda|yaourt|biscuit|épicerie)/.test(lower)) {
      return 'PIECE_CARTON_DLC';
    }
    if (/(pommade|crème|shampoing|parfum|déodorant|soin|lotion)/.test(lower)) {
      return 'COSMETIC_CARE';
    }
    if (/(maquillage|mèche|perruque|rouge à lèvres|vernis)/.test(lower)) {
      return 'COSMETIC_SHADE';
    }
    if (/(brosse|dentifrice|savon|hygiène|omo|javel|visserie|clou)/.test(lower)) {
      return 'PIECE_CARTON';
    }
    if (/(ciment|fer|tôle|carreau|peinture|matériau|brique)/.test(lower)) {
      return 'HARDWARE_MATERIAL';
    }
    if (/(câble|tuyau|grillage|découpe|mètre)/.test(lower)) {
      return 'HARDWARE_CUT_METER';
    }
    if (/(voiture|moto|véhicule|tricycle|engin|automobile)/.test(lower)) {
      return 'VEHICLE_VIN_WARRANTY';
    }
    if (/(pneu|pièce auto|batterie auto|lubrifiant|huile moteur)/.test(lower)) {
      return 'AUTO_PART';
    }
    if (/(téléphone|smartphone|ordinateur|tablette|tv|électroménager|frigo|clim|solaire|machine|outillage)/.test(lower)) {
      return 'TECH_SERIAL_WARRANTY';
    }
  }

  if (raw === 'STANDARD_PIECE' && !fallbackShopType) {
    return 'STANDARD_PIECE';
  }

  switch (fallbackShopType) {
    case 'FASHION':
      return 'APPAREL_SIZE_COLOR';
    case 'GROCERY':
      return 'PIECE_CARTON_DLC';
    case 'COSMETICS':
      return 'COSMETIC_CARE';
    case 'HARDWARE':
      return 'HARDWARE_MATERIAL';
    case 'ELECTRONICS':
      return 'TECH_SERIAL_WARRANTY';
    case 'AUTOMOTIVE':
      return 'VEHICLE_VIN_WARRANTY';
    default:
      return 'STANDARD_PIECE';
  }
}

export function getAllowedSellingModesForShopTypes(
  shopTypesInput: ShopType | ShopType[] | undefined,
): CategorySellingModeSpec[] {
  const list: ShopType[] = Array.isArray(shopTypesInput)
    ? shopTypesInput
    : shopTypesInput
      ? [shopTypesInput]
      : ['GENERAL'];
  const effective: ShopType[] = list.length > 0 ? list : ['GENERAL'];

  if (effective.includes('GENERAL')) {
    return Object.values(CATEGORY_SELLING_MODE_SPECS);
  }

  const matched = Object.values(CATEGORY_SELLING_MODE_SPECS).filter(
    (spec) =>
      spec.code === 'STANDARD_PIECE' ||
      spec.shopTypes.some((t) => effective.includes(t)),
  );
  return matched.length > 0 ? matched : Object.values(CATEGORY_SELLING_MODE_SPECS);
}

export function getSuggestedCategoriesForShopTypes(
  shopTypesInput: ShopType | ShopType[] | undefined,
): SuggestedCategoryTemplate[] {
  const list: ShopType[] = Array.isArray(shopTypesInput)
    ? shopTypesInput
    : shopTypesInput
      ? [shopTypesInput]
      : ['GENERAL'];
  const effective: ShopType[] = list.length > 0 ? list : ['GENERAL'];
  const seen = new Set<string>();
  const result: SuggestedCategoryTemplate[] = [];

  for (const st of effective) {
    for (const tpl of SHOP_TYPE_CATEGORY_TEMPLATES[st] || []) {
      const key = tpl.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(tpl);
      }
    }
  }
  return result;
}

export function normalizeBusinessProfile(
  shopType: unknown,
  rawProfile?: unknown,
): BusinessProfileConfig {
  const safeType = normalizeShopType(shopType);
  const preset = SHOP_TYPE_PRESETS[safeType];
  const obj =
    rawProfile && typeof rawProfile === 'object'
      ? (rawProfile as Partial<BusinessProfileConfig>)
      : {};

  const rawEnabledTypes = Array.isArray(obj.enabledShopTypes)
    ? obj.enabledShopTypes.filter((t): t is ShopType =>
        typeof t === 'string' && (SHOP_TYPES as readonly string[]).includes(t),
      )
    : [];
  const enabledShopTypes: ShopType[] = Array.from(
    new Set<ShopType>([safeType, ...rawEnabledTypes]),
  );

  // Fusionne les capacités de tous les types activés sur la boutique
  const mergedFromTypes = enabledShopTypes.reduce(
    (acc, t) => {
      const p = SHOP_TYPE_PRESETS[t];
      return {
        enableSizes: acc.enableSizes || p.enableSizes,
        enableColors: acc.enableColors || p.enableColors,
        enableMultiPhotos: acc.enableMultiPhotos || p.enableMultiPhotos,
        enableBulkUnits: acc.enableBulkUnits || p.enableBulkUnits,
        enableAmountSale: acc.enableAmountSale || p.enableAmountSale,
        enableExpiryTracking: acc.enableExpiryTracking || p.enableExpiryTracking,
        enableSerialWarranty: acc.enableSerialWarranty || p.enableSerialWarranty,
        enableBrandModel: acc.enableBrandModel || p.enableBrandModel,
        enableFastPosFavorites: acc.enableFastPosFavorites || p.enableFastPosFavorites,
        defaultUnits: Array.from(new Set([...acc.defaultUnits, ...p.defaultUnits])),
      };
    },
    {
      enableSizes: preset.enableSizes,
      enableColors: preset.enableColors,
      enableMultiPhotos: preset.enableMultiPhotos,
      enableBulkUnits: preset.enableBulkUnits,
      enableAmountSale: preset.enableAmountSale,
      enableExpiryTracking: preset.enableExpiryTracking,
      enableSerialWarranty: preset.enableSerialWarranty,
      enableBrandModel: preset.enableBrandModel,
      enableFastPosFavorites: preset.enableFastPosFavorites,
      defaultUnits: [...preset.defaultUnits],
    },
  );

  return {
    enableSizes:
      typeof obj.enableSizes === 'boolean' ? obj.enableSizes : mergedFromTypes.enableSizes,
    enableColors:
      typeof obj.enableColors === 'boolean' ? obj.enableColors : mergedFromTypes.enableColors,
    enableMultiPhotos:
      typeof obj.enableMultiPhotos === 'boolean'
        ? obj.enableMultiPhotos
        : mergedFromTypes.enableMultiPhotos,
    enableBulkUnits:
      typeof obj.enableBulkUnits === 'boolean'
        ? obj.enableBulkUnits
        : mergedFromTypes.enableBulkUnits,
    enableAmountSale:
      typeof obj.enableAmountSale === 'boolean'
        ? obj.enableAmountSale
        : mergedFromTypes.enableAmountSale,
    enableExpiryTracking:
      typeof obj.enableExpiryTracking === 'boolean'
        ? obj.enableExpiryTracking
        : mergedFromTypes.enableExpiryTracking,
    enableSerialWarranty:
      typeof obj.enableSerialWarranty === 'boolean'
        ? obj.enableSerialWarranty
        : mergedFromTypes.enableSerialWarranty,
    enableBrandModel:
      typeof obj.enableBrandModel === 'boolean'
        ? obj.enableBrandModel
        : mergedFromTypes.enableBrandModel,
    enableFastPosFavorites:
      typeof obj.enableFastPosFavorites === 'boolean'
        ? obj.enableFastPosFavorites
        : mergedFromTypes.enableFastPosFavorites,
    storefrontLayout:
      typeof obj.storefrontLayout === 'string' &&
      (STOREFRONT_LAYOUTS as readonly string[]).includes(obj.storefrontLayout)
        ? (obj.storefrontLayout as StorefrontLayout)
        : preset.storefrontLayout,
    defaultUnits:
      Array.isArray(obj.defaultUnits) && obj.defaultUnits.length > 0
        ? obj.defaultUnits.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        : mergedFromTypes.defaultUnits,
    enabledShopTypes,
  };
}
