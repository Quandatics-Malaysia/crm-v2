-- 1. New enum + junction table (empty at creation time, safe).
CREATE TYPE "public"."intercompany_share_type" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TABLE "intercompany_deal_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"partner_entity_id" text NOT NULL,
	"share_type" "intercompany_share_type" DEFAULT 'amount' NOT NULL,
	"share_value" numeric(14, 2) NOT NULL,
	"currency" char(3) DEFAULT 'MYR' NOT NULL,
	"manual_fx_rate" numeric(14, 6),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intercompany_deal_parties" ADD CONSTRAINT "intercompany_deal_parties_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_deal_parties" ADD CONSTRAINT "intercompany_deal_parties_partner_entity_id_organization_id_fk" FOREIGN KEY ("partner_entity_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intercompany_deal_parties_uq" ON "intercompany_deal_parties" USING btree ("opportunity_id","partner_entity_id");--> statement-breakpoint
CREATE INDEX "intercompany_deal_parties_partner_idx" ON "intercompany_deal_parties" USING btree ("partner_entity_id");--> statement-breakpoint

-- 2. Backfill: one party row per existing intercompany opportunity (old model
-- allowed exactly one handling partner, so this is a lossless 1:1 copy).
-- Percent-mode legacy deals: the old single partner's implied share equals
-- the complement of the origin's recognized_percent (same money, new shape).
INSERT INTO "intercompany_deal_parties" ("opportunity_id", "partner_entity_id", "share_type", "share_value", "currency")
SELECT
  o."id",
  o."handling_partner_entity_id",
  (CASE WHEN o."interco_leg_amount" IS NOT NULL THEN 'amount' ELSE 'percent' END)::intercompany_share_type,
  COALESCE(o."interco_leg_amount", 100 - COALESCE(o."recognized_percent", 0)),
  o."currency"
FROM "opportunities" o
WHERE o."is_intercompany" = true AND o."handling_partner_entity_id" IS NOT NULL;
--> statement-breakpoint

-- 3. New per-party mirror columns on intercompany_deals. share_value starts
-- nullable so the backfill below can populate existing rows before it's
-- tightened to NOT NULL.
ALTER TABLE "intercompany_deals" ADD COLUMN "share_type" "intercompany_share_type" DEFAULT 'amount' NOT NULL;--> statement-breakpoint
ALTER TABLE "intercompany_deals" ADD COLUMN "share_value" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "intercompany_deals" ADD COLUMN "partner_currency" char(3) DEFAULT 'MYR' NOT NULL;--> statement-breakpoint
ALTER TABLE "intercompany_deals" ADD COLUMN "manual_fx_rate" numeric(14, 6);--> statement-breakpoint

UPDATE "intercompany_deals" SET
  "share_type" = (CASE WHEN "partner_leg_amount" IS NOT NULL THEN 'amount' ELSE 'percent' END)::intercompany_share_type,
  "share_value" = COALESCE("partner_leg_amount", 100 - COALESCE("recognized_percent", 0)),
  "partner_currency" = "currency";
--> statement-breakpoint

ALTER TABLE "intercompany_deals" ALTER COLUMN "share_value" SET NOT NULL;--> statement-breakpoint

-- 4. Drop the old scalar columns now that their data lives in the new shapes.
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_handling_partner_entity_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN "interco_leg_amount";--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN "handling_partner_entity_id";--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN "handling_partner_name";--> statement-breakpoint
ALTER TABLE "intercompany_deals" DROP COLUMN "recognized_percent";--> statement-breakpoint
ALTER TABLE "intercompany_deals" DROP COLUMN "partner_leg_amount";--> statement-breakpoint

-- 5. Swap the per-opportunity unique index for a per-(opportunity,partner) one
-- now that a deal can mirror to more than one partner.
DROP INDEX "intercompany_deals_opportunity_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "intercompany_deals_opportunity_partner_uq" ON "intercompany_deals" USING btree ("opportunity_id","partner_tenant_id");
