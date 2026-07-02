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
  -- Forecast is driven by the Estimated Funnel Amount (the rep's estimate), NOT
  -- the quoted amount. The quoted value stays on the funnel for display only.
  COALESCE(o.estimated_amount, 0)::numeric(14, 2)
                                             AS opportunity_value,
  ROUND(
    COALESCE(o.estimated_amount, 0) * fs.probability / 100.0,
    2
  )                                          AS weighted_value,
  -- Appended last: CREATE OR REPLACE VIEW requires existing column order.
  o.recognized_percent,
  -- The tenant's OWN expected cut: on an intercompany middle-man deal only
  -- recognized_percent of the value is this entity's revenue (NULL = 100%,
  -- a fully-owned deal). Same estimated basis as weighted_value so the two
  -- columns stay comparable.
  ROUND(
    COALESCE(o.estimated_amount, 0)
      * fs.probability / 100.0
      * COALESCE(o.recognized_percent, 100) / 100.0,
    2
  )                                          AS recognized_weighted_value
FROM opportunities o
JOIN funnel_stages fs ON fs.id = o.current_stage_id
WHERE o.deleted_at IS NULL
  -- defense-in-depth: explicit tenant predicate on top of security_invoker + RLS,
  -- so a superuser/BYPASSRLS connection still cannot leak across tenants.
  AND o.tenant_id = current_setting('app.current_tenant', true)
  -- configurable per stage in Settings (e.g. only 4a + Won)
  AND fs.include_in_forecast = true
  -- only live (OPEN) or closed-won pipeline feeds the forecast; LOST/PARKED
  -- deals are never billable even if a stage was misconfigured to be included.
  AND fs.kind IN ('OPEN', 'WON');

-- Pipeline summary: counts + amounts per stage per funnel, grouped by currency
-- so amounts in different currencies are never summed together (no implicit FX);
-- a multi-currency tenant gets one row per (stage, currency). The grain also
-- carries `owner_member_id` so the action layer can apply record-level owner
-- scoping (a Rep must not see other owners' pipeline); callers re-aggregate
-- across owners after filtering. `currency` then `owner_member_id` are appended
-- last so CREATE OR REPLACE stays column-order compatible.
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
  -- Pipeline value = the Estimated Funnel Amount (consistent with the forecast).
  COALESCE(SUM(o.estimated_amount), 0)     AS total_amount,
  COALESCE(SUM(o.estimated_amount * fs.probability / 100.0), 0)::numeric(14, 2)
                                 AS weighted_amount,
  o.currency,
  o.owner_member_id
FROM opportunities o
JOIN funnel_stages fs ON fs.id = o.current_stage_id
WHERE o.deleted_at IS NULL
  AND o.tenant_id = current_setting('app.current_tenant', true)
GROUP BY o.tenant_id, o.funnel_id, o.currency, o.owner_member_id, fs.code, fs.name, fs.kind, fs.sort_order;

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
  AND tenant_id = current_setting('app.current_tenant', true)
GROUP BY tenant_id, from_stage_id;

GRANT SELECT ON v_billing_forecast, v_pipeline_summary, v_stage_velocity TO crm_app;
