-- Add optional quotation template selection fields at tenant/account levels.
-- Keeps behavior backwards-compatible by falling back to alias/default resolution.
ALTER TABLE "tenant_settings"
  ADD COLUMN IF NOT EXISTS "quotation_template_code" text;

ALTER TABLE "accounts"
  ADD COLUMN IF NOT EXISTS "quotation_template_code" text;
