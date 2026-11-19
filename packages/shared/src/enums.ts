export const USER_ROLES = ['SUPER_ADMIN', 'OWNER', 'AGENT', 'CLIENT'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TENANT_STATUSES = ['ACTIVE', 'PAST_DUE', 'SUSPENDED', 'TERMINATED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const SHOP_DB_STATUSES = ['PROVISIONING', 'READY', 'MIGRATION_FAILED'] as const;
export type ShopDbStatus = (typeof SHOP_DB_STATUSES)[number];

export const TAX_MODES = ['NONE', 'TTC', 'HT'] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export const NOTIFICATION_TYPES = [
  'ORDER',
  'MESSAGING',
  'STOCK',
  'CASH_FINANCE',
  'TRANSFER',
  'SECURITY',
  'PLATFORM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_PRIORITIES = ['INFO', 'WARNING', 'URGENT'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const AUDIT_ACTIONS = [
  'AUTH_LOGIN',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOCKOUT',
  'AUTH_LOGOUT',
  'AUTH_2FA_ENABLED',
  'AUTH_2FA_DISABLED',
  'SESSION_REVOKED',
  'MERCHANT_CREATED',
  'MERCHANT_UPDATED',
  'MERCHANT_STATUS_CHANGED',
  'SHOP_CREATED',
  'SHOP_UPDATED',
  'SHOP_SLUG_CHANGED',
  'SHOP_STATUS_CHANGED',
  'SHOP_DB_PROVISIONED',
  'SHOP_DB_MIGRATION_FAILED',
  'AGENT_CREATED',
  'AGENT_UPDATED',
  'AGENT_PERMISSIONS_UPDATED',
  'AGENT_DEACTIVATED',
  'AGENT_REACTIVATED',
  'AGENT_PASSWORD_RESET',
  'OPERATOR_CREATED',
  'OPERATOR_UPDATED',
  'OPERATOR_PIN_VERIFIED',
  'OPERATOR_PIN_FAILED',
  'TERMINAL_REGISTERED',
  'RECEIPT_RANGE_ALLOCATED',
  'SUPPORT_ACCESS_GRANTED',
  'SUPPORT_ACCESS_USED',
  'SUPPORT_ACCESS_REVOKED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const TENANT_STATUS_LABELS: Record<TenantStatus, string> = {
  ACTIVE: 'Actif',
  PAST_DUE: 'Impayé (délai de grâce)',
  SUSPENDED: 'Suspendu (lecture seule)',
  TERMINATED: 'Résilié',
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  OWNER: 'Propriétaire',
  AGENT: 'Agent',
  CLIENT: 'Client',
};

export const DEFAULT_CURRENCY = 'XOF';
export const DEFAULT_TIMEZONE = 'Africa/Bamako';
export const DEFAULT_DAILY_REPORT_TIME = '22:00';
