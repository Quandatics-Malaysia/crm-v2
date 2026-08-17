CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"list_key" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"sorting" jsonb NOT NULL,
	"visibility" jsonb NOT NULL,
	"page_size" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_views_owner_name_uq" UNIQUE("organization_id","member_id","list_key","name")
);
--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_one_default_uq" ON "saved_views" USING btree ("organization_id","member_id","list_key") WHERE "is_default" = true;
--> statement-breakpoint
CREATE INDEX "saved_views_organization_member_idx" ON "saved_views" USING btree ("organization_id","member_id");
--> statement-breakpoint
CREATE INDEX "saved_views_member_list_idx" ON "saved_views" USING btree ("member_id","list_key");
