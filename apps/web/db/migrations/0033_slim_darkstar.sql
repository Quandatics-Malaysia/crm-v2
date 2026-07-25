CREATE TABLE "intercompany_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"partner_tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"account_name" text,
	"currency" char(3) DEFAULT 'MYR' NOT NULL,
	"estimated_amount" numeric(14, 2),
	"quoted_amount" numeric(14, 2),
	"recognized_percent" numeric(5, 2),
	"status" text DEFAULT 'open' NOT NULL,
	"stage_name" text,
	"expected_close_date" date,
	"project_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intercompany_deals" ADD CONSTRAINT "intercompany_deals_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_deals" ADD CONSTRAINT "intercompany_deals_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_deals" ADD CONSTRAINT "intercompany_deals_partner_tenant_id_organization_id_fk" FOREIGN KEY ("partner_tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intercompany_deals_opportunity_uq" ON "intercompany_deals" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "intercompany_deals_partner_idx" ON "intercompany_deals" USING btree ("partner_tenant_id");--> statement-breakpoint
CREATE INDEX "intercompany_deals_tenant_idx" ON "intercompany_deals" USING btree ("tenant_id");