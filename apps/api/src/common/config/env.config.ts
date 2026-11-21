import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { z } from 'zod';

// Charge le .env à la racine du monorepo ou localement dans apps/api
const candidateEnvPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(__dirname, '../../../../../.env'),
];

for (const envPath of candidateEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const DEV_INSECURE_SECRETS = new Set([
  'dev_access_secret_replace_in_production_minimum_64_chars_0123456789abcdef',
  'dev_refresh_secret_replace_in_production_minimum_64_chars_fedcba9876543210',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'shopcontrol_dev_change_me',
]);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    POSTGRES_HOST: z.string().min(1).default('localhost'),
    POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    POSTGRES_USER: z.string().min(1).default('shopcontrol'),
    POSTGRES_PASSWORD: z.string().min(1),
    POSTGRES_CONTROL_DB: z.string().min(1).default('shopcontrol_control'),
    DATABASE_URL: z.string().min(10),
    POSTGRES_ADMIN_URL: z.string().min(10),
    SHOP_DB_PREFIX: z
      .string()
      .regex(/^[a-z][a-z0-9_]{2,24}$/, 'SHOP_DB_PREFIX doit être un préfixe PostgreSQL sûr.')
      .default('shopcontrol_shop_'),
    SHOP_DB_MAX_POOLED_CLIENTS: z.coerce.number().int().min(5).max(200).default(40),
    SHOP_DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(20).default(3),
    REDIS_URL: z.string().min(8).default('redis://localhost:6379'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET doit contenir au moins 32 caractères.'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET doit contenir au moins 32 caractères.'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(604800).default(86400),
    SESSION_TTL_OWNER_HOURS: z.coerce.number().int().min(1).max(8760).default(720),
    SESSION_TTL_AGENT_HOURS: z.coerce.number().int().min(1).max(8760).default(720),
    SESSION_TTL_SUPER_ADMIN_HOURS: z.coerce.number().int().min(1).max(8760).default(720),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    TOTP_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'TOTP_ENCRYPTION_KEY doit contenir exactement 64 caractères hexadécimaux (32 octets).'),
    ENABLE_SWAGGER: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    // Passerelle SMS / WhatsApp / e-mail (facultative) qui reçoit les relances destinées aux clients débiteurs.
    REMINDER_WEBHOOK_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
    REMINDER_WEBHOOK_TOKEN: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (DEV_INSECURE_SECRETS.has(data.JWT_ACCESS_SECRET) || data.JWT_ACCESS_SECRET.includes('dev_')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'En production, JWT_ACCESS_SECRET ne peut pas utiliser la valeur de développement.',
        });
      }
      if (DEV_INSECURE_SECRETS.has(data.JWT_REFRESH_SECRET) || data.JWT_REFRESH_SECRET.includes('dev_')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'En production, JWT_REFRESH_SECRET ne peut pas utiliser la valeur de développement.',
        });
      }
      if (DEV_INSECURE_SECRETS.has(data.TOTP_ENCRYPTION_KEY)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TOTP_ENCRYPTION_KEY'],
          message: 'En production, TOTP_ENCRYPTION_KEY ne peut pas utiliser la clé hexadécimale d’exemple.',
        });
      }
      if (data.POSTGRES_PASSWORD === 'shopcontrol_dev_change_me') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['POSTGRES_PASSWORD'],
          message: 'En production, POSTGRES_PASSWORD doit être un mot de passe sécurisé non-par-défaut.',
        });
      }
      if (!data.COOKIE_SECURE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COOKIE_SECURE'],
          message: 'En production, COOKIE_SECURE doit obligatoirement être défini à true pour sécuriser les cookies HTTPOnly.',
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }
  return cachedEnv;
}

export function resetEnvCacheForTest(): void {
  cachedEnv = null;
}
