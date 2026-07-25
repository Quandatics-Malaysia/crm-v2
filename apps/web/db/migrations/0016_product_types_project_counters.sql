CREATE TABLE "project_counters" (
	"tenant_id" text NOT NULL,
	"year" integer NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "project_counters_tenant_id_year_pk" PRIMARY KEY("tenant_id","year")
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "product_types" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "product_type_code" text;--> statement-breakpoint
ALTER TABLE "project_counters" ADD CONSTRAINT "project_counters_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;