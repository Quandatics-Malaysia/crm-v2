ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_handling_partner_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN "handling_partner_account_id";--> statement-breakpoint
-- Stage entry requirements are tenant custom fields only now; strip any legacy
-- preset keys (estimate/close date/contact/nature/quote) left on stage gates so
-- they stop surfacing as a hardcoded checklist in the advance dialog.
UPDATE "funnel_stages"
SET "required_fields" = COALESCE(
  (SELECT jsonb_agg(e) FROM jsonb_array_elements_text("required_fields") AS e WHERE e LIKE 'cf\_%'),
  '[]'::jsonb
)
WHERE "required_fields" IS NOT NULL AND "required_fields" <> '[]'::jsonb;