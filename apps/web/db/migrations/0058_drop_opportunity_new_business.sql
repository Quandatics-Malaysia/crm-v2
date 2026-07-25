-- "New Business?" was judged redundant against the SF-parity field set — the
-- edit dialog it lived in is also being retired in favor of inline editing.
ALTER TABLE "opportunities" DROP COLUMN IF EXISTS "new_business";
