-- Lot 8-11 : Mode de vente par catégorie (pilote le formulaire produit sans aucun mélange)
ALTER TABLE "categories"
  ADD COLUMN IF NOT EXISTS "selling_mode" VARCHAR(40) NOT NULL DEFAULT 'STANDARD_PIECE';
