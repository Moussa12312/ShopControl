-- Active l'extension trigramme PostgreSQL pour les recherches ILIKE ultra-rapides sur 100 000+ produits
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Index GIN trigramme sur les colonnes textuelles recherchées par autocomplete & recherche POS/Catalogue
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_sku_trgm ON products USING gin (sku gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_barcode_trgm ON products USING gin (barcode gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_brand_trgm ON products USING gin (brand gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_model_trgm ON products USING gin (model_name gin_trgm_ops);

-- Index composite pour le filtrage par statut et catégorie avec tri/pagination
CREATE INDEX IF NOT EXISTS idx_products_status_category_id ON products (status, category_id, id);
