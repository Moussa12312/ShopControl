import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE } from './enums';

/**
 * Formate un montant entier en XOF (jamais de décimales, séparateur d'espace fin).
 */
export function formatXof(amount: number, currency: string = DEFAULT_CURRENCY): string {
  if (!Number.isFinite(amount)) {
    return `0 ${currency === 'XOF' ? 'FCFA' : currency}`;
  }
  const rounded = Math.round(amount);
  const formatted = new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(rounded);
  return `${formatted} ${currency === 'XOF' ? 'FCFA' : currency}`;
}

export function formatDateTimeInTimezone(
  date: string | Date,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  const parsed = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function slugifyShopName(name: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return normalized || 'boutique';
}
