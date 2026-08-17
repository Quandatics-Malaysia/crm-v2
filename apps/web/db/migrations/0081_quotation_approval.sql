-- Quotation approval workflow. Existing quotation rows retain their status and
-- receive nullable metadata so this migration is additive and rollback-safe at
-- the application layer.
ALTER TYPE "quotation_status" ADD VALUE IF NOT EXISTS 'pending_approval';
--> statement-breakpoint
ALTER TYPE "quotation_status" ADD VALUE IF NOT EXISTS 'approved';
--> statement-breakpoint
ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "approver_member_id" text;
--> statement-breakpoint
ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "rejection_reason" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quotations_approver_member_id_fkey'
  ) THEN
    ALTER TABLE "quotations"
      ADD CONSTRAINT "quotations_approver_member_id_fkey"
      FOREIGN KEY ("approver_member_id") REFERENCES "member"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO "permissions" ("id", "key", "description")
VALUES (
  gen_random_uuid(),
  'quotation.approve',
  'Approve or reject quotations awaiting approval'
)
ON CONFLICT ("key") DO UPDATE
SET "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission_id")
SELECT r."tenant_id", r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'quotation.approve'
WHERE r."name" IN ('Owner', 'Admin', 'Developer', 'Manager')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
