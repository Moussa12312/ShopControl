-- ShopControl Lot 1 — Control Plane DB Initial Migration
-- Inclut le trigger PostgreSQL d'immutabilité (append-only) sur audit_logs

CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'OWNER', 'AGENT', 'CLIENT');
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'SUSPENDED', 'TERMINATED');
CREATE TYPE "ShopDbStatus" AS ENUM ('PROVISIONING', 'READY', 'MIGRATION_FAILED');
CREATE TYPE "TaxMode" AS ENUM ('NONE', 'TTC', 'HT');
CREATE TYPE "NotificationType" AS ENUM ('ORDER', 'MESSAGING', 'STOCK', 'CASH_FINANCE', 'TRANSFER', 'SECURITY', 'PLATFORM');
CREATE TYPE "NotificationPriority" AS ENUM ('INFO', 'WARNING', 'URGENT');

CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "legal_name" VARCHAR(160),
    "phone" VARCHAR(30) NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "status_reason" VARCHAR(500),
    "grace_period_ends_at" TIMESTAMPTZ(6),
    "currency" VARCHAR(5) NOT NULL DEFAULT 'XOF',
    "default_timezone" VARCHAR(60) NOT NULL DEFAULT 'Africa/Bamako',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shops" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "status_reason" VARCHAR(500),
    "db_name" VARCHAR(63) NOT NULL,
    "db_status" "ShopDbStatus" NOT NULL DEFAULT 'PROVISIONING',
    "db_schema_version" VARCHAR(64),
    "logo_url" VARCHAR(500),
    "phone" VARCHAR(30),
    "email" VARCHAR(160),
    "address" VARCHAR(255),
    "opening_hours" JSONB NOT NULL,
    "currency" VARCHAR(5) NOT NULL DEFAULT 'XOF',
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'Africa/Bamako',
    "daily_report_time" VARCHAR(5) NOT NULL DEFAULT '22:00',
    "tax_mode" "TaxMode" NOT NULL DEFAULT 'NONE',
    "default_tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "payment_methods" JSONB NOT NULL,
    "delivery_config" JSONB NOT NULL DEFAULT '{}',
    "receipt_settings" JSONB NOT NULL DEFAULT '{}',
    "require_operator_pin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shop_slug_redirects" (
    "id" UUID NOT NULL,
    "old_slug" VARCHAR(64) NOT NULL,
    "shop_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_slug_redirects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "merchant_id" UUID,
    "role" "UserRole" NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(30),
    "full_name" VARCHAR(120) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "totp_secret_encrypted" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_shop_access" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "permissions" JSONB NOT NULL,
    "max_discount_percent" INTEGER NOT NULL DEFAULT 0,
    "max_expense_amount_xof" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_shop_access_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(128) NOT NULL,
    "device_name" VARCHAR(120),
    "user_agent" VARCHAR(500),
    "ip_address" VARCHAR(64),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_active_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_access_grants" (
    "id" UUID NOT NULL,
    "super_admin_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "read_only" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_access_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "merchant_id" UUID,
    "shop_id" UUID,
    "recipient_user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'INFO',
    "title" VARCHAR(180) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "target_path" VARCHAR(255),
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "sequence_number" BIGSERIAL NOT NULL,
    "merchant_id" UUID,
    "shop_id" UUID,
    "actor_user_id" UUID,
    "actor_role" "UserRole",
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

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- Unique constraints & Indexes
CREATE INDEX "merchants_status_idx" ON "merchants"("status");
CREATE INDEX "merchants_created_at_idx" ON "merchants"("created_at");

CREATE UNIQUE INDEX "shops_slug_key" ON "shops"("slug");
CREATE UNIQUE INDEX "shops_db_name_key" ON "shops"("db_name");
CREATE INDEX "shops_merchant_id_idx" ON "shops"("merchant_id");
CREATE INDEX "shops_status_idx" ON "shops"("status");
CREATE INDEX "shops_merchant_id_status_idx" ON "shops"("merchant_id", "status");

CREATE UNIQUE INDEX "shop_slug_redirects_old_slug_key" ON "shop_slug_redirects"("old_slug");
CREATE INDEX "shop_slug_redirects_shop_id_idx" ON "shop_slug_redirects"("shop_id");

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_merchant_id_idx" ON "users"("merchant_id");
CREATE INDEX "users_role_idx" ON "users"("role");
CREATE INDEX "users_merchant_id_role_idx" ON "users"("merchant_id", "role");

CREATE UNIQUE INDEX "user_shop_access_user_id_shop_id_key" ON "user_shop_access"("user_id", "shop_id");
CREATE INDEX "user_shop_access_shop_id_idx" ON "user_shop_access"("shop_id");

CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

CREATE INDEX "support_access_grants_super_admin_id_merchant_id_expires_at_idx" ON "support_access_grants"("super_admin_id", "merchant_id", "expires_at");
CREATE INDEX "support_access_grants_merchant_id_created_at_idx" ON "support_access_grants"("merchant_id", "created_at");

CREATE INDEX "notifications_recipient_user_id_is_read_created_at_idx" ON "notifications"("recipient_user_id", "is_read", "created_at");
CREATE INDEX "notifications_merchant_id_created_at_idx" ON "notifications"("merchant_id", "created_at");

CREATE UNIQUE INDEX "audit_logs_sequence_number_key" ON "audit_logs"("sequence_number");
CREATE INDEX "audit_logs_merchant_id_created_at_idx" ON "audit_logs"("merchant_id", "created_at");
CREATE INDEX "audit_logs_shop_id_created_at_idx" ON "audit_logs"("shop_id", "created_at");
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- Foreign Keys
ALTER TABLE "shops" ADD CONSTRAINT "shops_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shop_slug_redirects" ADD CONSTRAINT "shop_slug_redirects_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_shop_access" ADD CONSTRAINT "user_shop_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_shop_access" ADD CONSTRAINT "user_shop_access_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_super_admin_id_fkey" FOREIGN KEY ("super_admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trigger d'immutabilité absolue sur audit_logs (Section 12.2, Critère #14)
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Les journaux d''audit ShopControl sont immuables (append-only) et ne peuvent être ni modifiés ni supprimés.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
