CREATE TYPE "public"."activity_entity_type" AS ENUM('account', 'person', 'lead', 'opportunity');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('note', 'call', 'meeting', 'email', 'system', 'stage_change', 'file');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_type" "activity_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"type" "activity_type" DEFAULT 'note' NOT NULL,
	"subject" text,
	"body" text,
	"member_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "registration_number" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "funnel_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "current_stage_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_entity_idx" ON "activities" USING btree ("tenant_id","entity_type","entity_id");