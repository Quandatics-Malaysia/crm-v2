-- ============================================================================
-- Report-only derived views. Forecast is NEVER an editable table.
-- These inherit RLS from the underlying tables, so a query by the crm_app role
-- with app.current_tenant set is automatically tenant-scoped.
-- ============================================================================

-- Weighted billing forecast: per OPEN opportunity, net-of-tax value × probability.
-- security_invoker => the view honors the querying role's RLS (tenant isolation).
CREATE OR REPLACE VIEW v_billing_forecast
WITH (security_invoker = true) AS
SELECT
  o.tenant_id,
  o.id                                       AS opportunity_id,
  o.name                                     AS opportunity_name,
  o.account_id,
  o.owner_member_id,
  o.funnel_id,
  fs.code                                    AS stage_code,
  fs.name                                    AS stage_name,
  fs.probability,
  o.currency,
  o.expected_close_date,
  (date_trunc('month', o.expected_close_date))::date AS forecast_month,
  -- net of tax: prefer the primary quote's taxable base, else the manual amount
  COALESCE(q.subtotal - q.discount_total, o.amount, 0)::numeric(14, 2)
                                             AS opportunity_value,
  ROUND(
    COALESCE(q.subtotal - q.discount_total, o.amount, 0) * fs.probability / 100.0,
    2
  )                                          AS weighted_value
FROM opportunities o
JOIN funnel_stages fs ON fs.id = o.current_stage_id
LEFT JOIN quotations q
  ON q.id = o.primary_quotation_id AND q.deleted_at IS NULL
WHERE o.deleted_at IS NULL
  -- configurable per stage in Settings (e.g. only 4a + Won)
  AND fs.include_in_forecast = true;

-- Pipeline summary: counts + amounts per stage per funnel.
CREATE OR REPLACE VIEW v_pipeline_summary
WITH (security_invoker = true) AS
SELECT
  o.tenant_id,
  o.funnel_id,
  fs.code        AS stage_code,
  fs.name        AS stage_name,
  fs.kind        AS stage_kind,
  fs.sort_order,
  COUNT(*)                       AS opportunity_count,
  COALESCE(SUM(o.amount), 0)     AS total_amount,
  COALESCE(SUM(o.amount * fs.probability / 100.0), 0)::numeric(14, 2)
                                 AS weighted_amount
FROM opportunities o
JOIN funnel_stages fs ON fs.id = o.current_stage_id
WHERE o.deleted_at IS NULL
GROUP BY o.tenant_id, o.funnel_id, fs.code, fs.name, fs.kind, fs.sort_order;

-- Stage velocity: average seconds an opportunity spent in each stage.
CREATE OR REPLACE VIEW v_stage_velocity
WITH (security_invoker = true) AS
SELECT
  tenant_id,
  from_stage_id  AS stage_id,
  AVG(EXTRACT(EPOCH FROM (changed_at - prev_changed_at)))
    FILTER (WHERE prev_changed_at IS NOT NULL) AS avg_seconds_in_stage,
  COUNT(*) FILTER (WHERE prev_changed_at IS NOT NULL) AS transitions
FROM (
  SELECT
    h.*,
    LAG(h.changed_at) OVER (
      PARTITION BY h.opportunity_id ORDER BY h.changed_at
    ) AS prev_changed_at
  FROM opportunity_stage_history h
) s
WHERE from_stage_id IS NOT NULL
GROUP BY tenant_id, from_stage_id;

GRANT SELECT ON v_billing_forecast, v_pipeline_summary, v_stage_velocity TO crm_app;
