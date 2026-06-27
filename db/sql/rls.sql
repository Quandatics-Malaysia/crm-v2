-- ============================================================================
-- Row-Level Security — applied by the migrate job AFTER drizzle migrations.
-- Every tenant-owned table is constrained to current_setting('app.current_tenant').
-- A missing setting => NULL predicate => zero rows (fail-closed).
-- Auth/org/member tables are intentionally EXCLUDED (Better Auth queries them
-- without a tenant context).
-- ============================================================================

-- Dedicated non-superuser app role. RLS is enforced for it (it is not the
-- table owner and not a superuser). Migrations/seed run as the superuser, which
-- bypasses RLS. Override the password via your secret manager in production.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app LOGIN PASSWORD 'change_me_crm_app';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO crm_app;

-- Tenant tables keyed by `tenant_id` ---------------------------------------
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'roles', 'role_permissions', 'membership_profiles',
    'leads', 'accounts', 'persons',
    'funnels', 'funnel_stages', 'opportunities', 'opportunity_stage_history',
    'stage_approval_requests', 'attachments',
    'tax_settings', 'quotations', 'quotation_line_items',
    'custom_field_defs', 'activities', 'projects', 'payment_milestones',
    'sales_orders'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.current_tenant', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant', true))
    $f$, t);
  END LOOP;
END
$$;

-- tenant_settings is keyed by organization_id ------------------------------
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_settings;
CREATE POLICY tenant_isolation ON tenant_settings
  USING (organization_id = current_setting('app.current_tenant', true))
  WITH CHECK (organization_id = current_setting('app.current_tenant', true));

-- audit_log: strictly tenant-scoped for the app role. Deployment-level
-- (NULL tenant) rows are written/read via the privileged connection only;
-- crm_app must never see another tenant's rows (the old `OR tenant_id IS NULL`
-- branch was a standing cross-tenant read/write hole).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_log;
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));

-- audit_log is append-only for the app role
REVOKE UPDATE, DELETE ON audit_log FROM crm_app;
