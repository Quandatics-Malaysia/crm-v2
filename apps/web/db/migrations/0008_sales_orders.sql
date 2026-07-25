CREATE TYPE "public"."sales_order_status" AS ENUM('submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"so_number" text,
	"document_kind" text,
	"payment_term" text,
	"status" "sales_order_status" DEFAULT 'submitted' NOT NULL,
	"submitted_by_member_id" text,
	"reviewed_by_member_id" text,
	"reject_reason" text,
	"notes" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "code_nature" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_submitted_by_member_id_member_id_fk" FOREIGN KEY ("submitted_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_reviewed_by_member_id_member_id_fk" FOREIGN KEY ("reviewed_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;