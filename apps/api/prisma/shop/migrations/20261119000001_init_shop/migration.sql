-- ShopControl Lot 1 — Dedicated Shop Database Initial Migration
-- Exécutée automatiquement dans la base dédiée de chaque nouvelle boutique (shopcontrol_shop_<code_unique>)

CREATE TABLE "shop_local_config" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "shop_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "shop_name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "currency" VARCHAR(5) NOT NULL DEFAULT 'XOF',
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'Africa/Bamako',
    "daily_report_time" VARCHAR(5) NOT NULL DEFAULT '22:00',
    "tax_mode" VARCHAR(16) NOT NULL DEFAULT 'NONE',
    "default_tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "require_operator_pin" BOOLEAN NOT NULL DEFAULT false,
    "payment_methods" JSONB NOT NULL,
    "opening_hours" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_local_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shop_operators" (
    "id" UUID NOT NULL,
    "first_name" VARCHAR(60) NOT NULL,
    "pin_hash" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shop_operators_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "terminals" (
    "id" UUID NOT NULL,
    "device_uid" VARCHAR(120) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "prefix" VARCHAR(12) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "terminals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receipt_number_ranges" (
    "id" UUID NOT NULL,
    "terminal_id" UUID NOT NULL,
    "series_code" VARCHAR(16) NOT NULL DEFAULT 'VTE',
    "range_start" INTEGER NOT NULL,
    "range_end" INTEGER NOT NULL,
    "current_number" INTEGER NOT NULL,
    "exhausted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_number_ranges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "receipt_number_ranges_bounds_chk" CHECK ("range_end" >= "range_start" AND "current_number" >= "range_start" - 1)
);

CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "client_operation_id" VARCHAR(120) NOT NULL,
    "endpoint" VARCHAR(160) NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shop_audit_logs" (
    "id" UUID NOT NULL,
    "sequence_number" BIGSERIAL NOT NULL,
    "actor_user_id" UUID,
    "actor_role" VARCHAR(32),
    "declared_operator_id" UUID,
    "declared_operator_name" VARCHAR(80),
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" VARCHAR(120),
    "before_data" JSONB,
    "after_data" JSONB,
    "reason" VARCHAR(500),
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "correlation_id" VARCHAR(120),
    "prev_hash" VARCHAR(64) NOT NULL,
    "entry_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shop_operators_is_active_idx" ON "shop_operators"("is_active");

CREATE UNIQUE INDEX "terminals_device_uid_key" ON "terminals"("device_uid");
CREATE UNIQUE INDEX "terminals_prefix_key" ON "terminals"("prefix");
CREATE INDEX "terminals_is_active_idx" ON "terminals"("is_active");

CREATE UNIQUE INDEX "receipt_number_ranges_series_code_range_start_key" ON "receipt_number_ranges"("series_code", "range_start");
CREATE INDEX "receipt_number_ranges_terminal_id_series_code_idx" ON "receipt_number_ranges"("terminal_id", "series_code");

CREATE UNIQUE INDEX "idempotency_records_client_operation_id_key" ON "idempotency_records"("client_operation_id");
CREATE INDEX "idempotency_records_created_at_idx" ON "idempotency_records"("created_at");

CREATE UNIQUE INDEX "shop_audit_logs_sequence_number_key" ON "shop_audit_logs"("sequence_number");
CREATE INDEX "shop_audit_logs_created_at_idx" ON "shop_audit_logs"("created_at");
CREATE INDEX "shop_audit_logs_action_created_at_idx" ON "shop_audit_logs"("action", "created_at");
CREATE INDEX "shop_audit_logs_declared_operator_id_created_at_idx" ON "shop_audit_logs"("declared_operator_id", "created_at");

ALTER TABLE "receipt_number_ranges"
  ADD CONSTRAINT "receipt_number_ranges_terminal_id_fkey"
  FOREIGN KEY ("terminal_id") REFERENCES "terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trigger d'immutabilité absolue sur shop_audit_logs (Section 12.2, Critère #14)
CREATE OR REPLACE FUNCTION prevent_shop_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Les journaux d''audit boutique ShopControl sont immuables (append-only).';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_shop_audit_logs_immutable
BEFORE UPDATE OR DELETE ON "shop_audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_shop_audit_log_mutation();
