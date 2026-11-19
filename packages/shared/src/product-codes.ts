const IGNORED_SHOP_WORDS = new Set([
  'BOUTIQUE',
  'MAGASIN',
  'ETS',
  'ETABLISSEMENT',
  'SHOP',
  'STORE',
  'CHEZ',
]);

const IGNORED_GENERAL_WORDS = new Set(['DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'ET', 'L']);

function stripDiacriticsUpper(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function extractTokens(value: string | null | undefined): string[] {
  return stripDiacriticsUpper(value)
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

function pickPrefix(
  value: string | null | undefined,
  fallback: string,
  ignoredWords: Set<string>,
): string {
  const tokens = extractTokens(value);
  if (tokens.length === 0) return fallback;
  const meaningful = tokens.filter((t) => !ignoredWords.has(t));
  const chosen = meaningful.length > 0 ? meaningful : tokens;
  const joined = chosen.join('');
  if (!joined) return fallback;
  return joined.padEnd(3, 'X').slice(0, 3);
}

function stableHash(input: string, mod: number): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % mod;
}

function normalizeFourDigitSuffix(uniqueSeed?: number | string): string {
  if (typeof uniqueSeed === 'number' && Number.isFinite(uniqueSeed)) {
    const abs = Math.abs(Math.floor(uniqueSeed));
    if (abs >= 1000 && abs <= 9999) return String(abs);
    return String(1000 + (abs % 9000));
  }
  if (typeof uniqueSeed === 'string' && uniqueSeed.trim().length > 0) {
    const trimmed = uniqueSeed.trim();
    if (/^\d{4}$/.test(trimmed) && Number(trimmed) >= 1000) return trimmed;
    return String(1000 + stableHash(trimmed, 9000));
  }
  const mix = (Date.now() + Math.floor(Math.random() * 9000)) % 9000;
  return String(1000 + mix);
}

export interface ProductCodeParams {
  shopName?: string | null;
  categoryName?: string | null;
  productName?: string | null;
  uniqueSeed?: number | string;
}

/**
 * Génère automatiquement une référence SKU lisible basée sur le nom de la boutique,
 * la catégorie, le nom du produit et un suffixe à 4 chiffres (AAA-BBB-CCC-1234).
 */
export function generateProductSku(params: ProductCodeParams): string {
  const shopCode = pickPrefix(params.shopName, 'SHP', IGNORED_SHOP_WORDS);
  const catCode = pickPrefix(params.categoryName, 'GEN', IGNORED_GENERAL_WORDS);
  const prodCode = pickPrefix(params.productName, 'ART', IGNORED_GENERAL_WORDS);
  const suffix = normalizeFourDigitSuffix(params.uniqueSeed);
  return `${shopCode}-${catCode}-${prodCode}-${suffix}`;
}

/**
 * Calcule le 13e chiffre de contrôle d'un code-barres EAN-13 (Mod-10 GS1).
 */
export function computeEan13CheckDigit(twelveDigits: string): string {
  if (!/^\d{12}$/.test(twelveDigits)) {
    throw new Error('EAN-13 base must contain exactly 12 digits.');
  }
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(twelveDigits[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * Vérifie qu'une chaîne est un code-barres EAN-13 valide.
 */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return computeEan13CheckDigit(code.slice(0, 12)) === code[12];
}

/**
 * Génère automatiquement un code-barres EAN-13 valide (préfixe interne GS1 "20")
 * à partir de la boutique, de la catégorie, du nom produit et d'un seed d'unicité.
 */
export function generateProductBarcodeEan13(params: ProductCodeParams): string {
  const shopNorm = stripDiacriticsUpper(params.shopName).trim() || 'SHOP';
  const catNorm = stripDiacriticsUpper(params.categoryName).trim() || 'GEN';
  const prodNorm = stripDiacriticsUpper(params.productName).trim() || 'ART';
  const seedStr =
    params.uniqueSeed !== undefined && String(params.uniqueSeed).trim() !== ''
      ? String(params.uniqueSeed)
      : `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const shopDigits = String(stableHash(shopNorm, 1000)).padStart(3, '0');
  const catDigits = String(stableHash(catNorm, 100)).padStart(2, '0');
  const itemDigits = String(stableHash(`${prodNorm}|${seedStr}`, 100000)).padStart(5, '0');

  const body12 = `20${shopDigits}${catDigits}${itemDigits}`;
  return `${body12}${computeEan13CheckDigit(body12)}`;
}
