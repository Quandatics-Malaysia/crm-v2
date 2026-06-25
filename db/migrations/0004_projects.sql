CREATE TYPE "public"."project_status" AS ENUM('planning', 'active', 'on_hold', 'completed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."attachable_type" ADD VALUE 'project';--> statement-breakpoint
ALTER TYPE "public"."activity_entity_type" ADD VALUE 'project';--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"project_code" text NOT NULL,
	"name" text NOT NULL,
	"account_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"quotation_id" uuid,
	"owner_member_id" text,
	"status" "project_status" DEFAULT 'planning' NOT NULL,
	"start_date" date,
	"value" numeric(14, 2),
	"currency" char(3) DEFAULT 'MYR' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "projects_code_uq" UNIQUE("tenant_id","project_code")
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "entity_code" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "project_next_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "project_pad_width" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_member_id_member_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;