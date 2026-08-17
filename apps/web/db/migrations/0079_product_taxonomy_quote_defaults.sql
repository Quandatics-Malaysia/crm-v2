-- Product categories now own stable subcategory codes. Keep the existing
-- product labels as display names while moving the product row to the newly
-- generated code. The migration is deliberately additive and idempotent.
ALTER TABLE "tenant_settings"
  ADD COLUMN IF NOT EXISTS "quote_default_notes" text;
--> statement-breakpoint
ALTER TABLE "tenant_settings"
  ADD COLUMN IF NOT EXISTS "quote_default_delivery" text;
--> statement-breakpoint
ALTER TABLE "tenant_settings"
  ADD COLUMN IF NOT EXISTS "quote_default_payment_term" text;
--> statement-breakpoint

WITH category_rows AS (
  SELECT
    ts."organization_id",
    c.ordinality AS category_ordinal,
    c.value AS category
  FROM "tenant_settings" ts
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(ts."product_codes") = 'array' THEN ts."product_codes"
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS c(value, ordinality)
), distinct_subcategories AS (
  SELECT
    c."organization_id",
    c.category_ordinal,
    lower(trim(p."subcategory")) AS display_key,
    min(trim(p."subcategory")) AS display_name
  FROM category_rows c
  JOIN "products" p
    ON p."tenant_id" = c."organization_id"
   AND upper(trim(p."product_code")) = upper(trim(c.category->>'code'))
   AND jsonb_typeof(c.category->'subcategories') IS DISTINCT FROM 'array'
   AND p."subcategory" IS NOT NULL
   AND length(trim(p."subcategory")) > 0
  GROUP BY c."organization_id", c.category_ordinal, lower(trim(p."subcategory"))
), normalized_subcategories AS (
  SELECT
    d.*,
    left(
      coalesce(
        nullif(regexp_replace(upper(d.display_name), '[^A-Z0-9]+', '_', 'g'), ''),
        'SUBCATEGORY'
      ),
      32
    ) AS code_base
  FROM distinct_subcategories d
), numbered_subcategories AS (
  SELECT
    n.*,
    row_number() OVER (
      PARTITION BY n."organization_id", n.category_ordinal, n.code_base
      ORDER BY lower(n.display_name), n.display_name
    ) AS code_number
  FROM normalized_subcategories n
), coded_subcategories AS (
  SELECT
    n.*,
    CASE
      WHEN n.code_number = 1 THEN n.code_base
      ELSE left(n.code_base, greatest(1, 32 - length(n.code_number::text) - 1))
        || '_' || n.code_number::text
    END AS code
  FROM numbered_subcategories n
), migrated_categories AS (
  SELECT
    c."organization_id",
    jsonb_agg(
      CASE
        WHEN jsonb_typeof(c.category->'subcategories') = 'array' THEN c.category
        ELSE jsonb_build_object(
          'code', c.category->>'code',
          'name', c.category->>'name',
          'subcategories', coalesce(
            (
              SELECT jsonb_agg(
                jsonb_build_object('code', s.code, 'name', s.display_name)
                ORDER BY s.code
              )
              FROM coded_subcategories s
              WHERE s."organization_id" = c."organization_id"
                AND s.category_ordinal = c.category_ordinal
            ),
            '[]'::jsonb
          )
        )
      END ORDER BY c.category_ordinal
    ) AS product_codes
  FROM category_rows c
  GROUP BY c."organization_id"
)
UPDATE "tenant_settings" ts
SET "product_codes" = m.product_codes,
    "updated_at" = now()
FROM migrated_categories m
WHERE ts."organization_id" = m."organization_id";
--> statement-breakpoint

WITH category_rows AS (
  SELECT
    ts."organization_id",
    c.ordinality AS category_ordinal,
    c.value AS category
  FROM "tenant_settings" ts
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(ts."product_codes") = 'array' THEN ts."product_codes"
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS c(value, ordinality)
), category_subcategories AS (
  SELECT
    c."organization_id",
    c.category->>'code' AS category_code,
    child.value->>'code' AS subcategory_code,
    lower(trim(child.value->>'name')) AS display_key
  FROM category_rows c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(c.category->'subcategories') = 'array'
        THEN c.category->'subcategories'
      ELSE '[]'::jsonb
    END
  ) AS child(value)
)
UPDATE "products" p
SET "subcategory" = s.subcategory_code,
    "updated_at" = now()
FROM category_subcategories s
WHERE p."tenant_id" = s."organization_id"
  AND upper(trim(p."product_code")) = upper(trim(s.category_code))
  AND lower(trim(p."subcategory")) = s.display_key;
