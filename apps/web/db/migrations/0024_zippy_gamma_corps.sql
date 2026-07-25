CREATE TABLE "deal_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"category" text,
	"contract_year" integer,
	"party_kind" text DEFAULT 'supplier' NOT NULL,
	"supplier_name" text,
	"po_number" text,
	"currency" char(3) DEFAULT 'MYR' NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"exchange_rate" numeric(12, 6) DEFAULT '1' NOT NULL,
	"amount_base" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_costs" ADD CONSTRAINT "deal_costs_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_costs" ADD CONSTRAINT "deal_costs_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_costs_opportunity_idx" ON "deal_costs" USING btree ("tenant_id","opportunity_id");