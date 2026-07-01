CREATE TABLE "contract_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"title" text,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" char(3) DEFAULT 'MYR' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "project_natures" jsonb;--> statement-breakpoint
ALTER TABLE "contract_years" ADD CONSTRAINT "contract_years_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_years" ADD CONSTRAINT "contract_years_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_years_opportunity_idx" ON "contract_years" USING btree ("tenant_id","opportunity_id");