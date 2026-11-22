-- Promotions programmées : remise automatique en % sur toute la boutique ou sur des produits, entre deux dates.
CREATE TABLE IF NOT EXISTS "promotions" (
  "id"               UUID           NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "name"             VARCHAR(120)   NOT NULL,
  "discount_percent" NUMERIC(5,2)   NOT NULL,
  "applies_to_all"   BOOLEAN        NOT NULL DEFAULT true,
  "product_ids"      UUID[]         NOT NULL DEFAULT ARRAY[]::UUID[],
  "starts_at"        TIMESTAMPTZ(6) NOT NULL,
  "ends_at"          TIMESTAMPTZ(6) NOT NULL,
  "is_active"        BOOLEAN        NOT NULL DEFAULT true,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "promotions_percent_check" CHECK ("discount_percent" > 0 AND "discount_percent" <= 100),
  CONSTRAINT "promotions_dates_check" CHECK ("ends_at" > "starts_at")
);
CREATE INDEX IF NOT EXISTS "promotions_active_dates_idx" ON "promotions"("is_active", "starts_at", "ends_at");
