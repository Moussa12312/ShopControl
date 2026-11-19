-- ShopControl Lot 2 — Dedicated Shop Database Migration (Gestion Commerciale)
-- Inclut : contraintes d'unicité partielle (1 session caisse ouverte / caisse, référence Mobile Money unique),
-- séquence de numérotation ventes sans trou, trigger append-only sur stock_movements.

CREATE SEQUENCE IF NOT EXISTS "sale_number_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "po_number_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "receipt_number_seq" START 1;

CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "category_id" UUID,
    "name" VARCHAR(140) NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "barcode" VARCHAR(64),
    "description" VARCHAR(2000),
    "unit" VARCHAR(24) NOT NULL DEFAULT 'unité',
    "sale_price_xof" INTEGER NOT NULL CHECK ("sale_price_xof" >= 0),
    "cost_price_xof" INTEGER CHECK ("cost_price_xof" IS NULL OR "cost_price_xof" >= 0),
    "alert_threshold" INTEGER NOT NULL DEFAULT 5 CHECK ("alert_threshold" >= 0),
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "image_urls" JSONB NOT NULL DEFAULT '[]',
    "import_batch_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sku" VARCHAR(64),
    "barcode" VARCHAR(64),
    "sale_price_xof" INTEGER CHECK ("sale_price_xof" IS NULL OR "sale_price_xof" >= 0),
    "cost_price_xof" INTEGER CHECK ("cost_price_xof" IS NULL OR "cost_price_xof" >= 0),
    "alert_threshold" INTEGER NOT NULL DEFAULT 5 CHECK ("alert_threshold" >= 0),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "variant_key" VARCHAR(40) NOT NULL DEFAULT 'BASE',
    "physical_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0 CHECK ("reserved_qty" >= 0),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "movement_type" VARCHAR(32) NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "qty_before" INTEGER NOT NULL,
    "qty_after" INTEGER NOT NULL,
    "unit_cost_xof" INTEGER,
    "reference_type" VARCHAR(40),
    "reference_id" VARCHAR(120),
    "reason" VARCHAR(500),
    "actor_user_id" UUID,
    "declared_operator_id" UUID,
    "declared_operator_name" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_cost_history" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "previous_cost_xof" INTEGER,
    "new_cost_xof" INTEGER NOT NULL,
    "received_qty" INTEGER NOT NULL,
    "received_unit_cost_xof" INTEGER NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_id" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_cost_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(30),
    "email" VARCHAR(160),
    "address" VARCHAR(255),
    "notes" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "import_batch_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "po_number" VARCHAR(40) NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'ORDERED',
    "expected_date" TIMESTAMPTZ(6),
    "notes" VARCHAR(500),
    "total_ordered_xof" INTEGER NOT NULL DEFAULT 0,
    "total_received_xof" INTEGER NOT NULL DEFAULT 0,
    "total_paid_xof" INTEGER NOT NULL DEFAULT 0,
    "actor_user_id" UUID,
    "declared_operator_name" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "product_name" VARCHAR(160) NOT NULL,
    "ordered_qty" INTEGER NOT NULL CHECK ("ordered_qty" > 0),
    "received_qty" INTEGER NOT NULL DEFAULT 0 CHECK ("received_qty" >= 0),
    "unit_cost_xof" INTEGER NOT NULL CHECK ("unit_cost_xof" >= 0),
    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_receipts" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "receipt_number" VARCHAR(40) NOT NULL,
    "notes" VARCHAR(500),
    "total_cost_xof" INTEGER NOT NULL,
    "actor_user_id" UUID,
    "declared_operator_id" UUID,
    "declared_operator_name" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_receipt_items" (
    "id" UUID NOT NULL,
    "purchase_receipt_id" UUID NOT NULL,
    "purchase_order_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "received_qty" INTEGER NOT NULL CHECK ("received_qty" > 0),
    "unit_cost_xof" INTEGER NOT NULL CHECK ("unit_cost_xof" >= 0),
    CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "amount_xof" INTEGER NOT NULL CHECK ("amount_xof" > 0),
    "payment_method_code" VARCHAR(32) NOT NULL,
    "transaction_ref" VARCHAR(120),
    "paid_from_cash_drawer" BOOLEAN NOT NULL DEFAULT false,
    "cash_movement_id" UUID,
    "notes" VARCHAR(300),
    "actor_user_id" UUID,
    "declared_operator_name" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "email" VARCHAR(160),
    "address" VARCHAR(255),
    "credit_limit_xof" INTEGER NOT NULL DEFAULT 0 CHECK ("credit_limit_xof" >= 0),
    "notes" VARCHAR(500),
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "import_batch_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cash_registers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "opening_amount_xof" INTEGER NOT NULL CHECK ("opening_amount_xof" >= 0),
    "theoretical_amount_xof" INTEGER NOT NULL DEFAULT 0,
    "counted_amount_xof" INTEGER,
    "discrepancy_xof" INTEGER,
    "opened_by_user_id" UUID,
    "opened_by_operator_id" UUID,
    "opened_by_operator_name" VARCHAR(80),
    "closed_by_user_id" UUID,
    "closed_by_operator_id" UUID,
    "closed_by_operator_name" VARCHAR(80),
    "opening_notes" VARCHAR(300),
    "closing_notes" VARCHAR(500),
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "amount_xof" INTEGER NOT NULL CHECK ("amount_xof" >= 0),
    "signed_amount_xof" INTEGER NOT NULL,
    "reference_type" VARCHAR(40),
    "reference_id" VARCHAR(120),
    "reason" VARCHAR(500),
    "actor_user_id" UUID,
    "declared_operator_id" UUID,
    "declared_operator_name" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "sale_number" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    "client_id" UUID,
    "cash_session_id" UUID,
    "client_operation_id" VARCHAR(120),
    "offline_synced" BOOLEAN NOT NULL DEFAULT false,
    "stock_conflict" BOOLEAN NOT NULL DEFAULT false,
    "gross_subtotal_xof" INTEGER NOT NULL,
    "discount_total_xof" INTEGER NOT NULL DEFAULT 0,
    "tax_mode" VARCHAR(16) NOT NULL DEFAULT 'NONE',
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "tax_total_xof" INTEGER NOT NULL DEFAULT 0,
    "rounding_xof" INTEGER NOT NULL DEFAULT 0,
    "total_xof" INTEGER NOT NULL,
    "paid_amount_xof" INTEGER NOT NULL DEFAULT 0,
    "due_amount_xof" INTEGER NOT NULL DEFAULT 0,
    "refunded_amount_xof" INTEGER NOT NULL DEFAULT 0,
    "notes" VARCHAR(400),
    "cancel_reason" VARCHAR(500),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_user_id" UUID,
    "actor_user_id" UUID,
    "declared_operator_id" UUID,
    "declared_operator_name" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sale_lines" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "product_name" VARCHAR(160) NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
    "returned_qty" INTEGER NOT NULL DEFAULT 0 CHECK ("returned_qty" >= 0),
    "unit_price_xof" INTEGER NOT NULL,
    "unit_cost_xof" INTEGER,
    "discount_xof" INTEGER NOT NULL DEFAULT 0,
    "tax_xof" INTEGER NOT NULL DEFAULT 0,
    "line_total_xof" INTEGER NOT NULL,
    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sale_payments" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "payment_method_code" VARCHAR(32) NOT NULL,
    "amount_xof" INTEGER NOT NULL CHECK ("amount_xof" > 0),
    "transaction_ref" VARCHAR(120),
    "affects_cash_drawer" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sale_returns" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "sale_line_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
    "condition" VARCHAR(24) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "actor_user_id" UUID,
    "declared_operator_id" UUID,
    "declared_operator_name" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sale_refunds" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "amount_xof" INTEGER NOT NULL CHECK ("amount_xof" > 0),
    "payment_method_code" VARCHAR(32) NOT NULL,
    "transaction_ref" VARCHAR(120),
    "cash_movement_id" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "actor_user_id" UUID,
    "declared_operator_id" UUID,
    "declared_operator_name" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sale_refunds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivables" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "initial_amount_xof" INTEGER NOT NULL CHECK ("initial_amount_xof" > 0),
    "paid_amount_xof" INTEGER NOT NULL DEFAULT 0,
    "remaining_amount_xof" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_payments" (
    "id" UUID NOT NULL,
    "receivable_id" UUID NOT NULL,
    "amount_xof" INTEGER NOT NULL CHECK ("amount_xof" > 0),
    "payment_method_code" VARCHAR(32) NOT NULL,
    "transaction_ref" VARCHAR(120),
    "cash_movement_id" UUID,
    "notes" VARCHAR(300),
    "actor_user_id" UUID,
    "declared_operator_id" UUID,
    "declared_operator_name" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "receivable_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "amount_xof" INTEGER NOT NULL CHECK ("amount_xof" > 0),
    "expense_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payment_method_code" VARCHAR(32) NOT NULL DEFAULT 'CASH',
    "paid_from_cash_drawer" BOOLEAN NOT NULL DEFAULT true,
    "cash_movement_id" UUID,
    "beneficiary" VARCHAR(120),
    "note" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "cancel_reason" VARCHAR(500),
    "cancelled_at" TIMESTAMPTZ(6),
    "actor_user_id" UUID,
    "declared_operator_id" UUID,
    "declared_operator_name" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(24) NOT NULL,
    "file_name" VARCHAR(160),
    "total_rows" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL,
    "error_count" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'COMMITTED',
    "created_entity_ids" JSONB NOT NULL DEFAULT '[]',
    "rolled_back_at" TIMESTAMPTZ(6),
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- Indexes & Contraintes uniques
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");
CREATE INDEX "categories_is_active_sort_order_idx" ON "categories"("is_active", "sort_order");

CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
CREATE INDEX "products_category_id_idx" ON "products"("category_id");
CREATE INDEX "products_status_idx" ON "products"("status");
CREATE INDEX "products_barcode_idx" ON "products"("barcode");
CREATE INDEX "products_import_batch_id_idx" ON "products"("import_batch_id");

CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");
CREATE INDEX "product_variants_barcode_idx" ON "product_variants"("barcode");

CREATE UNIQUE INDEX "stock_balances_product_id_variant_key_key" ON "stock_balances"("product_id", "variant_key");
CREATE INDEX "stock_balances_physical_qty_idx" ON "stock_balances"("physical_qty");

CREATE INDEX "stock_movements_product_id_created_at_idx" ON "stock_movements"("product_id", "created_at");
CREATE INDEX "stock_movements_movement_type_created_at_idx" ON "stock_movements"("movement_type", "created_at");
CREATE INDEX "stock_movements_reference_type_reference_id_idx" ON "stock_movements"("reference_type", "reference_id");

CREATE INDEX "product_cost_history_product_id_created_at_idx" ON "product_cost_history"("product_id", "created_at");

CREATE INDEX "suppliers_is_active_idx" ON "suppliers"("is_active");
CREATE INDEX "suppliers_import_batch_id_idx" ON "suppliers"("import_batch_id");

CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");
CREATE INDEX "purchase_orders_supplier_id_created_at_idx" ON "purchase_orders"("supplier_id", "created_at");
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

CREATE UNIQUE INDEX "purchase_receipts_receipt_number_key" ON "purchase_receipts"("receipt_number");
CREATE INDEX "purchase_receipts_purchase_order_id_idx" ON "purchase_receipts"("purchase_order_id");

CREATE INDEX "purchase_receipt_items_purchase_receipt_id_idx" ON "purchase_receipt_items"("purchase_receipt_id");

CREATE INDEX "supplier_payments_supplier_id_created_at_idx" ON "supplier_payments"("supplier_id", "created_at");
CREATE INDEX "supplier_payments_purchase_order_id_idx" ON "supplier_payments"("purchase_order_id");

CREATE UNIQUE INDEX "clients_phone_key" ON "clients"("phone");
CREATE INDEX "clients_is_blocked_idx" ON "clients"("is_blocked");
CREATE INDEX "clients_import_batch_id_idx" ON "clients"("import_batch_id");

CREATE UNIQUE INDEX "cash_registers_name_key" ON "cash_registers"("name");

CREATE INDEX "cash_sessions_register_id_status_idx" ON "cash_sessions"("register_id", "status");
CREATE INDEX "cash_sessions_opened_at_idx" ON "cash_sessions"("opened_at");
-- Une seule session OPEN par caisse à la fois (Section 5.5)
CREATE UNIQUE INDEX "cash_sessions_one_open_per_register_uidx" ON "cash_sessions"("register_id") WHERE "status" = 'OPEN';

CREATE INDEX "cash_movements_session_id_created_at_idx" ON "cash_movements"("session_id", "created_at");

CREATE UNIQUE INDEX "sales_sale_number_key" ON "sales"("sale_number");
CREATE UNIQUE INDEX "sales_client_operation_id_key" ON "sales"("client_operation_id");
CREATE INDEX "sales_created_at_idx" ON "sales"("created_at");
CREATE INDEX "sales_status_created_at_idx" ON "sales"("status", "created_at");
CREATE INDEX "sales_client_id_idx" ON "sales"("client_id");

CREATE INDEX "sale_lines_sale_id_idx" ON "sale_lines"("sale_id");
CREATE INDEX "sale_payments_sale_id_idx" ON "sale_payments"("sale_id");
-- Référence de transaction Mobile Money unique par boutique (Critère #24)
CREATE UNIQUE INDEX "sale_payments_method_ref_uidx" ON "sale_payments"("payment_method_code", "transaction_ref") WHERE "transaction_ref" IS NOT NULL;

CREATE INDEX "sale_returns_sale_id_idx" ON "sale_returns"("sale_id");
CREATE INDEX "sale_refunds_sale_id_idx" ON "sale_refunds"("sale_id");

CREATE UNIQUE INDEX "receivables_sale_id_key" ON "receivables"("sale_id");
CREATE INDEX "receivables_client_id_status_idx" ON "receivables"("client_id", "status");
CREATE INDEX "receivables_status_created_at_idx" ON "receivables"("status", "created_at");

CREATE INDEX "receivable_payments_receivable_id_idx" ON "receivable_payments"("receivable_id");
CREATE UNIQUE INDEX "receivable_payments_method_ref_uidx" ON "receivable_payments"("payment_method_code", "transaction_ref") WHERE "transaction_ref" IS NOT NULL;

CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");
CREATE INDEX "expenses_expense_date_idx" ON "expenses"("expense_date");
CREATE INDEX "expenses_status_expense_date_idx" ON "expenses"("status", "expense_date");

CREATE INDEX "import_batches_created_at_idx" ON "import_batches"("created_at");

-- Clés étrangères
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_cost_history" ADD CONSTRAINT "product_cost_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchase_receipt_id_fkey" FOREIGN KEY ("purchase_receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_line_id_fkey" FOREIGN KEY ("sale_line_id") REFERENCES "sale_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_receivable_id_fkey" FOREIGN KEY ("receivable_id") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trigger append-only sur stock_movements (Section 6.2 : mouvements jamais effacés/modifiés)
CREATE OR REPLACE FUNCTION prevent_stock_movement_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Les mouvements de stock ShopControl sont immuables (append-only). Utilisez un mouvement inverse ou de correction.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_movements_immutable
BEFORE UPDATE OR DELETE ON "stock_movements"
FOR EACH ROW EXECUTE FUNCTION prevent_stock_movement_mutation();
