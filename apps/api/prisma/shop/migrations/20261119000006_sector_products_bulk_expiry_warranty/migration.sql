-- Lots 8, 9, 10, 11 : Profil métier boutique, Gros/Détail, Vente fractionnée, Péremptions (DLC) & Garanties/IMEI

-- 1. Profil métier local boutique
ALTER TABLE "shop_local_config" ADD COLUMN IF NOT EXISTS "shop_type" VARCHAR(24) NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "shop_local_config" ADD COLUMN IF NOT EXISTS "business_profile" JSONB NOT NULL DEFAULT '{}';

-- 2. Attributs sectoriels sur products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "brand" VARCHAR(80);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "model_name" VARCHAR(100);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "volume_label" VARCHAR(40);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_pinned_pos" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "bulk_unit_label" VARCHAR(32);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "units_per_bulk" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "bulk_sale_price_xof" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "allow_fractional_sale" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "expiry_date" TIMESTAMPTZ(6);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "warranty_months" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "track_serial_number" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "products_is_pinned_pos_idx" ON "products"("is_pinned_pos");
CREATE INDEX IF NOT EXISTS "products_expiry_date_idx" ON "products"("expiry_date");

-- 3. Reste fractionnaire en milli-unités sur stock_balances (ex. grammes / millilitres)
ALTER TABLE "stock_balances" ADD COLUMN IF NOT EXISTS "fractional_remainder_milli" INTEGER NOT NULL DEFAULT 0;

-- 4. Table des lots de péremption (FEFO)
CREATE TABLE IF NOT EXISTS "product_batches" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "batch_number" VARCHAR(60),
  "expiry_date" TIMESTAMPTZ(6) NOT NULL,
  "initial_qty" INTEGER NOT NULL,
  "remaining_qty" INTEGER NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  "notes" VARCHAR(300),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "product_batches_product_id_status_expiry_date_idx" ON "product_batches"("product_id", "status", "expiry_date");
CREATE INDEX IF NOT EXISTS "product_batches_expiry_date_status_idx" ON "product_batches"("expiry_date", "status");

-- 5. Colonnes Gros/Détail, Fractionnaire, N° de série/IMEI & Garantie sur sale_lines
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "sold_in_bulk" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "bulk_multiplier" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "unit_label" VARCHAR(32);
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "fractional_qty_milli" INTEGER;
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "serial_number" VARCHAR(120);
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "warranty_ends_at" TIMESTAMPTZ(6);
CREATE INDEX IF NOT EXISTS "sale_lines_serial_number_idx" ON "sale_lines"("serial_number");

-- 6. Colonnes Gros/Détail sur online_order_lines
ALTER TABLE "online_order_lines" ADD COLUMN IF NOT EXISTS "sold_in_bulk" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "online_order_lines" ADD COLUMN IF NOT EXISTS "bulk_multiplier" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "online_order_lines" ADD COLUMN IF NOT EXISTS "unit_label" VARCHAR(32);
