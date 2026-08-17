ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "attention_contact_id" uuid;
--> statement-breakpoint
ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "delivery" text;
--> statement-breakpoint
ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "payment_term" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quotations_attention_contact_id_fkey'
  ) THEN
    ALTER TABLE "quotations"
      ADD CONSTRAINT "quotations_attention_contact_id_fkey"
      FOREIGN KEY ("attention_contact_id") REFERENCES "persons"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
