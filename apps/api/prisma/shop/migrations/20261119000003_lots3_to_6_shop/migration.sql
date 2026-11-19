-- ============================================================================
-- Migration Boutique Dédiée : Lots 3, 4 & 5
-- Documents/Tickets/Avoirs, Bilans journaliers archivés, Commandes vitrine QR & Anti-abus
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS "credit_note_number_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS "order_number_seq" START WITH 1 INCREMENT BY 1;

ALTER TABLE "sale_refunds"
  ADD COLUMN IF NOT EXISTS "credit_note_number" VARCHAR(40);
CREATE UNIQUE INDEX IF NOT EXISTS "sale_refunds_credit_note_number_key"
  ON "sale_refunds"("credit_note_number")
  WHERE "credit_note_number" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "sale_refunds_created_at_idx" ON "sale_refunds"("created_at");

CREATE TABLE IF NOT EXISTS "sale_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_number" VARCHAR(40) NOT NULL,
    "document_type" VARCHAR(24) NOT NULL,
    "sale_id" UUID NOT NULL,
    "refund_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'VALID',
    "print_count" INTEGER NOT NULL DEFAULT 0,
    "last_printed_at" TIMESTAMPTZ(6),
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sale_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_documents_document_number_key" UNIQUE ("document_number"),
    CONSTRAINT "sale_documents_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "sale_documents_sale_id_idx" ON "sale_documents"("sale_id");
CREATE INDEX IF NOT EXISTS "sale_documents_document_type_created_at_idx" ON "sale_documents"("document_type", "created_at");

CREATE TABLE IF NOT EXISTS "daily_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "report_date" VARCHAR(10) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PROVISIONAL',
    "generated_by" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    "metrics" JSONB NOT NULL,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "daily_reports_report_date_version_key" UNIQUE ("report_date", "version")
);
CREATE INDEX IF NOT EXISTS "daily_reports_report_date_status_idx" ON "daily_reports"("report_date", "status");

CREATE TABLE IF NOT EXISTS "online_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_number" VARCHAR(40) NOT NULL,
    "secret_token" VARCHAR(96) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'NEW',
    "fulfillment_mode" VARCHAR(16) NOT NULL,
    "client_name" VARCHAR(120) NOT NULL,
    "client_phone" VARCHAR(30) NOT NULL,
    "delivery_address" VARCHAR(255),
    "delivery_district" VARCHAR(100),
    "delivery_notes" VARCHAR(400),
    "delivery_fee_xof" INTEGER NOT NULL DEFAULT 0,
    "subtotal_xof" INTEGER NOT NULL,
    "total_xof" INTEGER NOT NULL,
    "deposit_paid_xof" INTEGER NOT NULL DEFAULT 0,
    "out_of_hours" BOOLEAN NOT NULL DEFAULT false,
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "converted_sale_id" UUID,
    "cancel_or_reject_reason" VARCHAR(500),
    "client_ip" VARCHAR(64),
    "confirmed_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "online_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "online_orders_order_number_key" UNIQUE ("order_number"),
    CONSTRAINT "online_orders_secret_token_key" UNIQUE ("secret_token"),
    CONSTRAINT "online_orders_converted_sale_id_key" UNIQUE ("converted_sale_id")
);
CREATE INDEX IF NOT EXISTS "online_orders_status_created_at_idx" ON "online_orders"("status", "created_at");
CREATE INDEX IF NOT EXISTS "online_orders_client_phone_created_at_idx" ON "online_orders"("client_phone", "created_at");
CREATE INDEX IF NOT EXISTS "online_orders_client_ip_created_at_idx" ON "online_orders"("client_ip", "created_at");

CREATE TABLE IF NOT EXISTS "online_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "product_name" VARCHAR(160) NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "ordered_qty" INTEGER NOT NULL,
    "delivered_qty" INTEGER NOT NULL DEFAULT 0,
    "unit_price_xof" INTEGER NOT NULL,
    "line_total_xof" INTEGER NOT NULL,
    CONSTRAINT "online_order_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "online_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "online_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "online_order_lines_order_id_idx" ON "online_order_lines"("order_id");

CREATE TABLE IF NOT EXISTS "online_order_status_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "from_status" VARCHAR(24),
    "to_status" VARCHAR(24) NOT NULL,
    "reason" VARCHAR(500),
    "actor_user_id" UUID,
    "declared_operator_name" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "online_order_status_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "online_order_status_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "online_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "online_order_status_events_order_id_created_at_idx" ON "online_order_status_events"("order_id", "created_at");

CREATE TABLE IF NOT EXISTS "blocked_phones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(300),
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blocked_phones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "blocked_phones_phone_key" UNIQUE ("phone")
);

CREATE TABLE IF NOT EXISTS "order_tracking_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_number" VARCHAR(40) NOT NULL,
    "ip_address" VARCHAR(64) NOT NULL,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_tracking_attempts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "order_tracking_attempts_order_number_ip_address_created_at_idx"
  ON "order_tracking_attempts"("order_number", "ip_address", "created_at");
