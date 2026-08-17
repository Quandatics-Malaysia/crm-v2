-- Opportunity names are system identifiers. Preserve every historical code and
-- project code; only align the legacy display name with its existing code.
UPDATE "opportunities"
SET "name" = "code"
WHERE "name" IS DISTINCT FROM "code";
