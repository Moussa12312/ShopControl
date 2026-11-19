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

const envSchema = z.object({
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
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  SESSION_TTL_OWNER_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  SESSION_TTL_AGENT_HOURS: z.coerce.number().int().min(1).max(24).default(4),
  SESSION_TTL_SUPER_ADMIN_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  TOTP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TOTP_ENCRYPTION_KEY doit contenir exactement 64 caractères hexadécimaux (32 octets).'),
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
