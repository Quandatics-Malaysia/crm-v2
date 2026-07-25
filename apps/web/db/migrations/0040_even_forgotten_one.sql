CREATE TYPE "public"."finance_doc_kind" AS ENUM('delivery_order', 'invoice', 'credit_note', 'receipt', 'rfq', 'purchase_order', 'purchase_invoice', 'payment');--> statement-breakpoint
CREATE TYPE "public"."finance_doc_status" AS ENUM('draft', 'issued', 'settled', 'cancelled');--> statement-breakpoint
CREATE TABLE "finance_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" "finance_doc_kind" NOT NULL,
	"number" text NOT NULL,
	"parent_id" uuid,
	"sales_order_id" uuid,
	"project_id" uuid,
	"milestone_id" uuid,
	"party_name" text,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" char(3) DEFAULT 'MYR' NOT NULL,
	"status" "finance_doc_status" DEFAULT 'draft' NOT NULL,
	"doc_date" date,
	"due_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_docs_number_uq" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "finance_module" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_docs" ADD CONSTRAINT "finance_docs_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_docs" ADD CONSTRAINT "finance_docs_parent_id_finance_docs_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."finance_docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_docs" ADD CONSTRAINT "finance_docs_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_docs" ADD CONSTRAINT "finance_docs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_docs" ADD CONSTRAINT "finance_docs_milestone_id_payment_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."payment_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_docs_tenant_kind_idx" ON "finance_docs" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "finance_docs_parent_idx" ON "finance_docs" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "finance_docs_project_idx" ON "finance_docs" USING btree ("project_id");