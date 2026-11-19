-- Plans configurables par le Super Admin (Mois, Année, Vente directe) + cycle de facturation & essai gratuit marchand
CREATE TABLE IF NOT EXISTS "platform_plan_configs" (
  "code" VARCHAR(32) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "tagline" VARCHAR(200) NOT NULL DEFAULT '',
  "badge" VARCHAR(40),
  "monthly_price_xof" INTEGER NOT NULL DEFAULT 15000,
  "yearly_price_xof" INTEGER NOT NULL DEFAULT 150000,
  "direct_sale_price_xof" INTEGER NOT NULL DEFAULT 350000,
  "allow_monthly" BOOLEAN NOT NULL DEFAULT true,
  "allow_yearly" BOOLEAN NOT NULL DEFAULT true,
  "allow_direct_sale" BOOLEAN NOT NULL DEFAULT true,
  "trial_days" INTEGER NOT NULL DEFAULT 14,
  "max_shops" INTEGER NOT NULL DEFAULT 1,
  "max_agents_per_shop" INTEGER NOT NULL DEFAULT 3,
  "features" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_plan_configs_pkey" PRIMARY KEY ("code")
);

ALTER TABLE "merchant_subscriptions"
  ADD COLUMN IF NOT EXISTS "billing_cycle" VARCHAR(24) NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN IF NOT EXISTS "price_xof" INTEGER NOT NULL DEFAULT 25000,
  ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMPTZ(6);

UPDATE "merchant_subscriptions"
SET "price_xof" = "monthly_price_xof"
WHERE "price_xof" = 25000 AND "monthly_price_xof" <> 25000;
