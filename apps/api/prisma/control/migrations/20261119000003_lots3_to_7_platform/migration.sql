-- ============================================================================
-- Migration Control Plane : Lots 4, 6 & 7
-- Transferts inter-boutiques, Messagerie unifiée, Administration plateforme
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS "transfer_number_seq" START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS "support_ticket_number_seq" START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS "stock_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "transfer_number" VARCHAR(40) NOT NULL,
    "source_shop_id" UUID NOT NULL,
    "dest_shop_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requested_by_user_id" UUID NOT NULL,
    "requested_by_operator_name" VARCHAR(80),
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "rejected_reason" VARCHAR(500),
    "dispatched_by_user_id" UUID,
    "dispatched_by_operator_name" VARCHAR(80),
    "dispatched_at" TIMESTAMPTZ(6),
    "received_by_user_id" UUID,
    "received_by_operator_name" VARCHAR(80),
    "received_at" TIMESTAMPTZ(6),
    "has_discrepancy" BOOLEAN NOT NULL DEFAULT false,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_transfers_transfer_number_key" UNIQUE ("transfer_number"),
    CONSTRAINT "stock_transfers_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_transfers_source_shop_id_fkey" FOREIGN KEY ("source_shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_transfers_dest_shop_id_fkey" FOREIGN KEY ("dest_shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "stock_transfers_merchant_id_status_created_at_idx" ON "stock_transfers"("merchant_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "stock_transfers_source_shop_id_status_idx" ON "stock_transfers"("source_shop_id", "status");
CREATE INDEX IF NOT EXISTS "stock_transfers_dest_shop_id_status_idx" ON "stock_transfers"("dest_shop_id", "status");

CREATE TABLE IF NOT EXISTS "stock_transfer_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transfer_id" UUID NOT NULL,
    "source_product_id" UUID NOT NULL,
    "dest_product_id" UUID,
    "product_sku" VARCHAR(64) NOT NULL,
    "product_name" VARCHAR(160) NOT NULL,
    "sale_price_xof" INTEGER NOT NULL DEFAULT 0,
    "unit_cost_xof" INTEGER,
    "requested_qty" INTEGER NOT NULL,
    "dispatched_qty" INTEGER NOT NULL DEFAULT 0,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "discrepancy_reason" VARCHAR(300),
    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "stock_transfer_items_transfer_id_idx" ON "stock_transfer_items"("transfer_id");

CREATE TABLE IF NOT EXISTS "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "shop_id" UUID,
    "type" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "subject" VARCHAR(180) NOT NULL,
    "order_id" UUID,
    "order_number" VARCHAR(40),
    "client_name" VARCHAR(120),
    "client_phone" VARCHAR(30),
    "client_secret_token" VARCHAR(96),
    "assigned_agent_user_id" UUID,
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversations_client_secret_token_key" UNIQUE ("client_secret_token"),
    CONSTRAINT "conversations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conversations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "conversations_merchant_id_last_message_at_idx" ON "conversations"("merchant_id", "last_message_at");
CREATE INDEX IF NOT EXISTS "conversations_shop_id_last_message_at_idx" ON "conversations"("shop_id", "last_message_at");
CREATE INDEX IF NOT EXISTS "conversations_type_last_message_at_idx" ON "conversations"("type", "last_message_at");

CREATE TABLE IF NOT EXISTS "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "sender_role" VARCHAR(24) NOT NULL,
    "sender_user_id" UUID,
    "sender_name" VARCHAR(120) NOT NULL,
    "declared_operator_name" VARCHAR(80),
    "body" VARCHAR(2000) NOT NULL,
    "attachment_url" VARCHAR(500),
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

CREATE TABLE IF NOT EXISTS "merchant_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "plan_code" VARCHAR(32) NOT NULL DEFAULT 'PRO',
    "monthly_price_xof" INTEGER NOT NULL DEFAULT 25000,
    "max_shops" INTEGER NOT NULL DEFAULT 5,
    "max_agents_per_shop" INTEGER NOT NULL DEFAULT 10,
    "enabled_modules" JSONB NOT NULL DEFAULT '["POS","INVENTORY","PURCHASES","MULTI_SHOP","ECOMMERCE_QR","MESSAGING","REPORTS"]'::jsonb,
    "current_period_start" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_end" TIMESTAMPTZ(6) NOT NULL,
    "auto_suspend_grace_days" INTEGER NOT NULL DEFAULT 7,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "merchant_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "merchant_subscriptions_merchant_id_key" UNIQUE ("merchant_id"),
    CONSTRAINT "merchant_subscriptions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "platform_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "amount_xof" INTEGER NOT NULL,
    "payment_method_code" VARCHAR(32) NOT NULL,
    "reference" VARCHAR(120),
    "period_label" VARCHAR(80) NOT NULL,
    "notes" VARCHAR(300),
    "recorded_by_user_id" UUID NOT NULL,
    "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_payments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "platform_payments_merchant_id_paid_at_idx" ON "platform_payments"("merchant_id", "paid_at");

CREATE TABLE IF NOT EXISTS "support_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_number" VARCHAR(32) NOT NULL,
    "merchant_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "subject" VARCHAR(180) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'OPEN',
    "priority" VARCHAR(16) NOT NULL DEFAULT 'INFO',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_tickets_ticket_number_key" UNIQUE ("ticket_number"),
    CONSTRAINT "support_tickets_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "support_tickets_merchant_id_status_idx" ON "support_tickets"("merchant_id", "status");
CREATE INDEX IF NOT EXISTS "support_tickets_status_updated_at_idx" ON "support_tickets"("status", "updated_at");

CREATE TABLE IF NOT EXISTS "support_ticket_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "sender_role" VARCHAR(24) NOT NULL,
    "sender_name" VARCHAR(120) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "support_ticket_messages_ticket_id_created_at_idx" ON "support_ticket_messages"("ticket_id", "created_at");

CREATE TABLE IF NOT EXISTS "platform_announcements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(1500) NOT NULL,
    "priority" VARCHAR(16) NOT NULL DEFAULT 'INFO',
    "target_role" VARCHAR(16) NOT NULL DEFAULT 'ALL',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "published_by_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_announcements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "platform_announcements_is_active_created_at_idx" ON "platform_announcements"("is_active", "created_at");
