-- Lot 8 : Types de boutiques & profil d'options métier dynamique
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "shop_type" VARCHAR(24) NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "business_profile" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS "shops_shop_type_idx" ON "shops"("shop_type");
