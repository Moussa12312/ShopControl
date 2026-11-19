ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "supplied_products" VARCHAR(400);
