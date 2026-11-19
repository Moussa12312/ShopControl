-- Tailles & Couleurs disponibles par produit + choix client sur commandes vitrine
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "available_sizes" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "available_colors" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "online_order_lines" ADD COLUMN IF NOT EXISTS "selected_size" VARCHAR(32);
ALTER TABLE "online_order_lines" ADD COLUMN IF NOT EXISTS "selected_color" VARCHAR(40);
