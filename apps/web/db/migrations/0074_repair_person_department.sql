-- Production repair: an older deployment recorded 0071 as applied while the
-- contact column was absent. Keep this additive and idempotent for all tenants.
ALTER TABLE "persons"
  ADD COLUMN IF NOT EXISTS "department" text;
