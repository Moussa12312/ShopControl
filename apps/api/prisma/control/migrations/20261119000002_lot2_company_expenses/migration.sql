-- ShopControl Lot 2 — Dépenses communes d'entreprise (vue consolidée Propriétaire, Section 5.6 & 11.2)

CREATE TABLE "company_expenses" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "category_name" VARCHAR(80) NOT NULL,
    "amount_xof" INTEGER NOT NULL CHECK ("amount_xof" > 0),
    "expense_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payment_method_code" VARCHAR(32) NOT NULL DEFAULT 'BANK',
    "beneficiary" VARCHAR(120),
    "note" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "cancel_reason" VARCHAR(500),
    "cancelled_at" TIMESTAMPTZ(6),
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "company_expenses_merchant_id_expense_date_idx" ON "company_expenses"("merchant_id", "expense_date");
CREATE INDEX "company_expenses_merchant_id_status_idx" ON "company_expenses"("merchant_id", "status");

ALTER TABLE "company_expenses"
  ADD CONSTRAINT "company_expenses_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
