-- Add contact department field. Nullable and additive for import/backward-safe.
ALTER TABLE "persons" ADD COLUMN "department" text;
