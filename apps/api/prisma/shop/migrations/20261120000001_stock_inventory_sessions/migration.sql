CREATE SEQUENCE IF NOT EXISTS "inventory_number_seq" START 1;

CREATE TABLE IF NOT EXISTS "stock_inventory_sessions" (
    "id" UUID NOT NULL,
    "session_number" VARCHAR(40) NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'COMPLETED',
    "total_items_checked" INTEGER NOT NULL,
    "discrepancies_count" INTEGER NOT NULL,
    "total_loss_xof" INTEGER NOT NULL DEFAULT 0,
    "total_gain_xof" INTEGER NOT NULL DEFAULT 0,
    "net_variance_xof" INTEGER NOT NULL DEFAULT 0,
    "actor_user_id" UUID,
    "declared_operator_name" VARCHAR(80),
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_inventory_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_inventory_sessions_session_number_key" UNIQUE ("session_number")
);

CREATE TABLE IF NOT EXISTS "stock_inventory_session_items" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "product_name" VARCHAR(160) NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "expected_qty" INTEGER NOT NULL,
    "counted_qty" INTEGER NOT NULL,
    "variance_qty" INTEGER NOT NULL,
    "unit_cost_xof" INTEGER,
    "variance_value_xof" INTEGER,
    CONSTRAINT "stock_inventory_session_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_inventory_session_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "stock_inventory_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "stock_inventory_sessions_created_at_idx" ON "stock_inventory_sessions"("created_at");
CREATE INDEX IF NOT EXISTS "stock_inventory_session_items_session_id_idx" ON "stock_inventory_session_items"("session_id");
CREATE INDEX IF NOT EXISTS "stock_inventory_session_items_product_id_idx" ON "stock_inventory_session_items"("product_id");
