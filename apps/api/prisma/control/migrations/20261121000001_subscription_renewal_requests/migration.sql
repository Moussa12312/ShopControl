-- Demandes de renouvellement / activation d'abonnement soumises par le propriétaire.
-- Le Super Admin vérifie la référence de transfert puis approuve (période prolongée,
-- compte réactivé) ou rejette. La référence de paiement est obligatoire.
CREATE TABLE IF NOT EXISTS "subscription_renewal_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "merchant_id" UUID NOT NULL,
  "plan_code" VARCHAR(32) NOT NULL,
  "billing_cycle" VARCHAR(24) NOT NULL,
  "amount_xof" INTEGER NOT NULL,
  "payment_method_code" VARCHAR(32) NOT NULL,
  "reference" VARCHAR(120) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "requested_by_user_id" UUID NOT NULL,
  "reviewed_by_user_id" UUID,
  "review_note" VARCHAR(300),
  "reviewed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "subscription_renewal_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_renewal_requests_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "subscription_renewal_requests_merchant_id_status_idx"
  ON "subscription_renewal_requests"("merchant_id", "status");
CREATE INDEX IF NOT EXISTS "subscription_renewal_requests_status_created_at_idx"
  ON "subscription_renewal_requests"("status", "created_at");
-- Une même référence de transfert ne peut servir qu'à une seule demande non rejetée.
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_renewal_requests_ref_unique"
  ON "subscription_renewal_requests"("payment_method_code", "reference")
  WHERE "status" <> 'REJECTED';
