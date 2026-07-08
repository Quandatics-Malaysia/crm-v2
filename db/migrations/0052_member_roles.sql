-- Multiple roles per member (many-to-many). Effective permissions = union.
CREATE TABLE "member_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "member_id" text NOT NULL,
  "role_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "member_roles_uq" UNIQUE ("member_id", "role_id")
);
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE cascade;
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE cascade;
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE cascade;

-- Backfill each member's current single role as their first assignment.
INSERT INTO "member_roles" ("tenant_id", "member_id", "role_id")
SELECT "tenant_id", "member_id", "role_id" FROM "membership_profiles" WHERE "role_id" IS NOT NULL
ON CONFLICT ("member_id", "role_id") DO NOTHING;
