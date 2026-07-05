ALTER TABLE "opportunities" ADD COLUMN "interco_leg_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "intercompany_deals" ADD COLUMN "partner_leg_amount" numeric(14, 2);