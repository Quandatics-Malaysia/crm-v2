-- 0084_operator_alerts
-- Platform-level operator alert log: unexpected errors and deployment incidents
-- written by the server error boundary, readable by superadmin/vendors.

CREATE TABLE IF NOT EXISTS operator_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  summary text NOT NULL,
  detail text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'server',
  tenant_id text,
  tenant_name text,
  user_id text,
  user_email text,
  stack_summary text,
  error_digest text,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_alerts_severity_idx ON operator_alerts (severity);
CREATE INDEX IF NOT EXISTS operator_alerts_created_idx ON operator_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS operator_alerts_tenant_idx ON operator_alerts (tenant_id);

-- Grant access when the app role exists (fresh test databases create it later).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    GRANT SELECT, INSERT ON operator_alerts TO crm_app;
  END IF;
END
$$;
