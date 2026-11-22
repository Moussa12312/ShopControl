-- Migration: Programme de Fidélité
-- Lot 6 – Feature 1: Loyalty Program (points, tiers, rewards)

-- Règles du programme (1 par boutique max)
CREATE TABLE IF NOT EXISTS "loyalty_rules" (
  "id"                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "is_enabled"           BOOLEAN     NOT NULL DEFAULT false,
  "points_per_100_xof"   INTEGER     NOT NULL DEFAULT 1,
  "min_sale_xof"         INTEGER     NOT NULL DEFAULT 500,
  "expiry_days"          INTEGER,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- Paliers de fidélité
CREATE TABLE IF NOT EXISTS "loyalty_tiers" (
  "id"                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "name"                 VARCHAR(60) NOT NULL,
  "min_lifetime_points"  INTEGER     NOT NULL DEFAULT 0,
  "discount_percent"     NUMERIC(5,2) NOT NULL DEFAULT 0,
  "badge_color"          VARCHAR(20) NOT NULL DEFAULT '#6366f1',
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- Compte fidélité par client
CREATE TABLE IF NOT EXISTS "loyalty_accounts" (
  "id"                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "client_id"            UUID        NOT NULL UNIQUE,
  "current_points"       INTEGER     NOT NULL DEFAULT 0,
  "lifetime_points"      INTEGER     NOT NULL DEFAULT 0,
  "tier_id"              UUID,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "loyalty_accounts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE,
  CONSTRAINT "loyalty_accounts_tier_id_fkey"   FOREIGN KEY ("tier_id")   REFERENCES "loyalty_tiers"("id") ON DELETE SET NULL
);

-- Transactions de points (earn/redeem)
CREATE TABLE IF NOT EXISTS "loyalty_transactions" (
  "id"                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "account_id"           UUID        NOT NULL,
  "sale_id"              UUID,
  "type"                 VARCHAR(16) NOT NULL, -- 'EARN' | 'REDEEM' | 'EXPIRE' | 'ADJUST'
  "points"               INTEGER     NOT NULL,
  "note"                 VARCHAR(200),
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "loyalty_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "loyalty_accounts"("id") ON DELETE CASCADE
);

-- Récompenses disponibles
CREATE TABLE IF NOT EXISTS "loyalty_rewards" (
  "id"                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "name"                 VARCHAR(120) NOT NULL,
  "points_cost"          INTEGER     NOT NULL,
  "discount_type"        VARCHAR(16) NOT NULL DEFAULT 'PERCENT', -- 'PERCENT' | 'FIXED'
  "discount_value"       NUMERIC(10,2) NOT NULL,
  "max_discount_xof"     INTEGER,
  "is_active"            BOOLEAN     NOT NULL DEFAULT true,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "loyalty_accounts_client_id_idx" ON "loyalty_accounts"("client_id");
CREATE INDEX IF NOT EXISTS "loyalty_transactions_account_id_idx" ON "loyalty_transactions"("account_id");
CREATE INDEX IF NOT EXISTS "loyalty_transactions_sale_id_idx" ON "loyalty_transactions"("sale_id");
CREATE INDEX IF NOT EXISTS "loyalty_tiers_min_lifetime_idx" ON "loyalty_tiers"("min_lifetime_points");

-- Paliers par défaut
INSERT INTO "loyalty_tiers" ("name", "min_lifetime_points", "discount_percent", "badge_color") VALUES
  ('Bronze',   0,    0,   '#cd7f32'),
  ('Argent',   500,  2,   '#9ca3af'),
  ('Or',       1500, 5,   '#f59e0b'),
  ('Platine',  5000, 10,  '#06b6d4')
ON CONFLICT DO NOTHING;
