-- Compte client optionnel sur la vitrine + Gestion directe des dettes clients

-- 1. Colonnes de compte client optionnel sur clients
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "has_account" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "password_hash" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMPTZ(6);
CREATE INDEX IF NOT EXISTS "clients_email_idx" ON "clients"("email");

-- 2. Lien optionnel OnlineOrder -> Client
ALTER TABLE "online_orders" ADD COLUMN IF NOT EXISTS "client_id" UUID;
CREATE INDEX IF NOT EXISTS "online_orders_client_id_created_at_idx" ON "online_orders"("client_id", "created_at");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'online_orders_client_id_fkey'
  ) THEN
    ALTER TABLE "online_orders"
      ADD CONSTRAINT "online_orders_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "clients"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. Dettes clients directes (sale_id optionnel + description + échéance + traçabilité)
ALTER TABLE "receivables" ALTER COLUMN "sale_id" DROP NOT NULL;
ALTER TABLE "receivables" ADD COLUMN IF NOT EXISTS "description" VARCHAR(400);
ALTER TABLE "receivables" ADD COLUMN IF NOT EXISTS "due_date" TIMESTAMPTZ(6);
ALTER TABLE "receivables" ADD COLUMN IF NOT EXISTS "actor_user_id" UUID;
ALTER TABLE "receivables" ADD COLUMN IF NOT EXISTS "declared_operator_name" VARCHAR(80);
CREATE INDEX IF NOT EXISTS "receivables_due_date_idx" ON "receivables"("due_date");
