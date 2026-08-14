-- Template registry for quotations (tenant-scoped).
-- 1) Tenant-scoped list of allowed template codes + renderer mapping.
-- 2) Keep all existing behavior by seeding default/qar/cc on every tenant.

CREATE TABLE "quotation_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "label" text NOT NULL,
  "notes" text,
  "legacy_template_code" text,
  "render_mode" text NOT NULL DEFAULT 'builtin',
  "html_template" text,
  "css_template" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "quotation_templates_org_code_uq" UNIQUE ("organization_id", "code")
);

INSERT INTO "quotation_templates" (
  "organization_id",
  "code",
  "label",
  "legacy_template_code",
  "render_mode"
)
SELECT
  o.id,
  template_data.code,
  template_data.label,
  template_data.legacy_template_code,
  'builtin'
FROM "organization" o
CROSS JOIN (
  VALUES
    ('default', 'Default', 'default'),
    ('qar', 'QAR', 'qar'),
    ('cc', 'CC', 'cc')
) AS template_data(code, label, legacy_template_code)
ON CONFLICT ("organization_id", "code") DO NOTHING;

-- Keep existing account/tenant config columns untouched; this migration only
-- adds the registry and seed data.
