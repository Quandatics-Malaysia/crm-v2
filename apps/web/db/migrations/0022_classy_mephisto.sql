ALTER TABLE "opportunities" ADD COLUMN "estimated_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "recognized_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "project_year" integer;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "is_intercompany" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "handling_partner_account_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_handling_partner_account_id_accounts_id_fk" FOREIGN KEY ("handling_partner_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: seed Estimated Funnel Amount from the prior single 'amount' so the
-- forecast (now driven by estimated_amount) doesn't reset to zero for existing deals.
UPDATE "opportunities" SET "estimated_amount" = "amount" WHERE "estimated_amount" IS NULL AND "amount" IS NOT NULL;
