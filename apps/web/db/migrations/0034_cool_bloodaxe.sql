CREATE TYPE "public"."intercompany_response" AS ENUM('accepted', 'declined');--> statement-breakpoint
CREATE TABLE "pending_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid,
	"tier_level" integer DEFAULT 0 NOT NULL,
	"invited_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intercompany_deal_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"origin_tenant_id" text NOT NULL,
	"response" "intercompany_response" NOT NULL,
	"reason" text,
	"responded_by_member_id" text,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "intercompany_partner_ids" jsonb;--> statement-breakpoint
ALTER TABLE "quotation_line_items" ADD COLUMN "project_nature_code" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "intercompany_deal_id" uuid;--> statement-breakpoint
ALTER TABLE "intercompany_deals" ADD COLUMN "stage_probability" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "intercompany_deals" ADD COLUMN "include_in_forecast" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_invites" ADD CONSTRAINT "pending_invites_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_invites" ADD CONSTRAINT "pending_invites_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_invites" ADD CONSTRAINT "pending_invites_invited_by_member_id_member_id_fk" FOREIGN KEY ("invited_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_deal_responses" ADD CONSTRAINT "intercompany_deal_responses_deal_id_intercompany_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."intercompany_deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_deal_responses" ADD CONSTRAINT "intercompany_deal_responses_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_deal_responses" ADD CONSTRAINT "intercompany_deal_responses_origin_tenant_id_organization_id_fk" FOREIGN KEY ("origin_tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_deal_responses" ADD CONSTRAINT "intercompany_deal_responses_responded_by_member_id_member_id_fk" FOREIGN KEY ("responded_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_invites_email_uq" ON "pending_invites" USING btree ("tenant_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "intercompany_deal_responses_deal_uq" ON "intercompany_deal_responses" USING btree ("deal_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_intercompany_deal_id_intercompany_deals_id_fk" FOREIGN KEY ("intercompany_deal_id") REFERENCES "public"."intercompany_deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Defensive: demote all but the newest live primary per funnel so the partial
-- unique index below can build even if historical data drifted (is_primary is
-- a display pointer; app code re-syncs it). Accepted duplicates are NOT fixed
-- silently — if any exist the index build fails loudly, surfacing real data
-- corruption instead of voiding a quote behind the tenant's back.
UPDATE "quotations" q SET "is_primary" = false
WHERE q."is_primary" AND q."deleted_at" IS NULL AND EXISTS (
  SELECT 1 FROM "quotations" q2
  WHERE q2."opportunity_id" = q."opportunity_id"
    AND q2."is_primary" AND q2."deleted_at" IS NULL
    AND (q2."created_at" > q."created_at"
         OR (q2."created_at" = q."created_at" AND q2."id" > q."id"))
);--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_accepted_uq" ON "quotations" USING btree ("opportunity_id") WHERE "quotations"."status" = 'accepted' AND "quotations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_primary_uq" ON "quotations" USING btree ("opportunity_id") WHERE "quotations"."is_primary" AND "quotations"."deleted_at" IS NULL;