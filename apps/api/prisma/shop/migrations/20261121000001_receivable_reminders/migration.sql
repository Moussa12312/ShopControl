-- Suivi des relances automatiques des créances (dettes clients).
ALTER TABLE "receivables" ADD COLUMN IF NOT EXISTS "reminder_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "receivables" ADD COLUMN IF NOT EXISTS "last_reminded_at" TIMESTAMPTZ(6);
CREATE INDEX IF NOT EXISTS "receivables_status_due_date_idx" ON "receivables"("status", "due_date");
