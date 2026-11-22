-- Migration: Commissions Agents & Paie
-- Lot 6 – Feature 4: Agent Commission & Bonus Management

-- Règles de commission (par agent ou globale)
CREATE TABLE IF NOT EXISTS "commission_rules" (
  "id"                   UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "agent_user_id"        UUID,            -- NULL = règle globale
  "percent_bps"          INTEGER      NOT NULL DEFAULT 200,  -- 200 = 2.00%
  "min_sale_xof"         INTEGER      NOT NULL DEFAULT 0,
  "is_active"            BOOLEAN      NOT NULL DEFAULT true,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- Grand livre des commissions gagnées
CREATE TABLE IF NOT EXISTS "commission_ledger" (
  "id"                   UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "sale_id"              UUID         NOT NULL,
  "agent_user_id"        UUID         NOT NULL,
  "sale_total_xof"       INTEGER      NOT NULL,
  "percent_bps"          INTEGER      NOT NULL,
  "earned_xof"           INTEGER      NOT NULL,
  "pay_period"           VARCHAR(7)   NOT NULL, -- 'YYYY-MM'
  "paid_at"              TIMESTAMPTZ(6),
  "paid_by_user_id"      UUID,
  "note"                 VARCHAR(200),
  "applied_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "commission_ledger_sale_id_key" UNIQUE ("sale_id")
);

CREATE INDEX IF NOT EXISTS "commission_ledger_agent_user_id_idx"  ON "commission_ledger"("agent_user_id");
CREATE INDEX IF NOT EXISTS "commission_ledger_pay_period_idx"      ON "commission_ledger"("pay_period");
CREATE INDEX IF NOT EXISTS "commission_ledger_paid_at_idx"         ON "commission_ledger"("paid_at");
CREATE INDEX IF NOT EXISTS "commission_rules_agent_user_id_idx"    ON "commission_rules"("agent_user_id");
