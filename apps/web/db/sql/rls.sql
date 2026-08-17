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
    'roles', 'role_permissions', 'membership_profiles', 'member_roles',
    'leads', 'accounts', 'persons',
    'pipelines', 'pipeline_stages', 'opportunities', 'funnels', 'funnel_stage_history',
    'stage_approval_requests', 'attachments',
    'tax_settings', 'quotations', 'quotation_line_items',
    'custom_field_defs', 'activities', 'projects', 'payment_milestones',
    'sales_orders', 'project_counters', 'products', 'deal_costs',
    'lead_companies', 'opportunity_products', 'contracts',
    'contract_years', 'pending_invites', 'finance_docs',
    'platform_subscription_invoices', 'platform_subscription_collection_milestones'
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

-- intercompany_deals: visible to BOTH sides of the deal ----------------------
-- Deliberately NOT in the single-tenant loop above — its isolation is
-- two-sided by design. The origin entity (tenant_id) writes the mirror row;
-- the handling partner entity (partner_tenant_id) may only read it.
ALTER TABLE intercompany_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE intercompany_deals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON intercompany_deals;
DROP POLICY IF EXISTS interco_select ON intercompany_deals;
DROP POLICY IF EXISTS interco_insert ON intercompany_deals;
DROP POLICY IF EXISTS interco_update ON intercompany_deals;
DROP POLICY IF EXISTS interco_delete ON intercompany_deals;
CREATE POLICY interco_select ON intercompany_deals FOR SELECT
  USING (
    tenant_id = current_setting('app.current_tenant', true)
    OR partner_tenant_id = current_setting('app.current_tenant', true)
  );
CREATE POLICY interco_insert ON intercompany_deals FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
CREATE POLICY interco_update ON intercompany_deals FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
CREATE POLICY interco_delete ON intercompany_deals FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant', true));

-- intercompany_deal_responses: mirror image of the deals table --------------
-- Written by the PARTNER (tenant_id = the responding entity); the ORIGIN may
-- only read (origin_tenant_id) so it can show the handshake status.
ALTER TABLE intercompany_deal_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE intercompany_deal_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON intercompany_deal_responses;
DROP POLICY IF EXISTS interco_resp_select ON intercompany_deal_responses;
DROP POLICY IF EXISTS interco_resp_insert ON intercompany_deal_responses;
DROP POLICY IF EXISTS interco_resp_update ON intercompany_deal_responses;
DROP POLICY IF EXISTS interco_resp_delete ON intercompany_deal_responses;
CREATE POLICY interco_resp_select ON intercompany_deal_responses FOR SELECT
  USING (
    tenant_id = current_setting('app.current_tenant', true)
    OR origin_tenant_id = current_setting('app.current_tenant', true)
  );
CREATE POLICY interco_resp_insert ON intercompany_deal_responses FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
CREATE POLICY interco_resp_update ON intercompany_deal_responses FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
CREATE POLICY interco_resp_delete ON intercompany_deal_responses FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant', true));

-- api_keys: tenant-scoped, keyed by organization_id (like tenant_settings) ----
-- The tenant column is `organization_id` (text — Better Auth ids), so the
-- predicate is a plain text compare with NO ::uuid cast. A missing GUC =>
-- NULL predicate => zero rows (fail-closed), same as every other table.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON api_keys;
CREATE POLICY tenant_isolation ON api_keys
  USING (organization_id = current_setting('app.current_tenant', true))
  WITH CHECK (organization_id = current_setting('app.current_tenant', true));

-- saved_views: per-member views are tenant-scoped by organization_id. The
-- Server Actions add the member owner predicate for every read and mutation.
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON saved_views;
CREATE POLICY tenant_isolation ON saved_views
  USING (organization_id = current_setting('app.current_tenant', true))
  WITH CHECK (organization_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON api_keys TO crm_app;

-- Deployment entitlement state is global, not tenant-owned. The app role has
-- no direct table access: narrowly-scoped SECURITY DEFINER functions serialize
-- verified applies, record bounded rejection metadata, and expose one safe row.
ALTER TABLE deployment_control_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_control_state FORCE ROW LEVEL SECURITY;
ALTER TABLE deployment_entitlement_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_entitlement_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON deployment_control_state FROM crm_app;
REVOKE ALL ON deployment_entitlement_history FROM crm_app;
REVOKE ALL ON SEQUENCE deployment_entitlement_history_id_seq FROM crm_app;
GRANT EXECUTE ON FUNCTION record_deployment_entitlement_rejection(text, text, bigint, timestamp with time zone) TO crm_app;
GRANT EXECUTE ON FUNCTION apply_verified_deployment_entitlement(text, text, bigint, text, text, text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, public.deployment_subscription_status, integer, text[], timestamp with time zone) TO crm_app;
GRANT EXECUTE ON FUNCTION read_deployment_entitlement_state(timestamp with time zone) TO crm_app;

-- Deployment seat reservations are global and contain normalized identities.
-- Only the fixed-shape aggregate may cross the application-role boundary.
ALTER TABLE deployment_seat_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_seat_state FORCE ROW LEVEL SECURITY;
ALTER TABLE deployment_seat_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_seat_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE deployment_bootstrap_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_bootstrap_state FORCE ROW LEVEL SECURITY;
ALTER TABLE deployment_runtime_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_runtime_metadata FORCE ROW LEVEL SECURITY;
REVOKE ALL ON deployment_seat_state FROM crm_app;
REVOKE ALL ON deployment_seat_reservations FROM crm_app;
REVOKE ALL ON deployment_bootstrap_state FROM crm_app;
REVOKE ALL ON deployment_runtime_metadata FROM crm_app;
-- Seat occupancy rows are mutated only inside the SECURITY DEFINER seams.
-- Column-level UPDATE keeps non-lifecycle profile administration available
-- without permitting status/tenant/member identity reassignment.
REVOKE INSERT, UPDATE, DELETE ON member FROM crm_app;
REVOKE INSERT, UPDATE, DELETE ON pending_invites FROM crm_app;
REVOKE INSERT, UPDATE, DELETE ON membership_profiles FROM crm_app;
GRANT UPDATE (role_id, tier_level, manager_member_id, updated_at) ON membership_profiles TO crm_app;
GRANT EXECUTE ON FUNCTION read_deployment_status_rollup() TO crm_app;
GRANT EXECUTE ON FUNCTION read_deployment_seat_usage(timestamp with time zone) TO crm_app;
REVOKE EXECUTE ON FUNCTION require_deployment_seat_actor(text, text, text) FROM crm_app;
REVOKE EXECUTE ON FUNCTION perform_deployment_invitation_reservation(uuid, text, text, uuid, integer, text, text, text, timestamp with time zone, timestamp with time zone) FROM crm_app;
REVOKE EXECUTE ON FUNCTION perform_deployment_membership_activation(text, text, text, uuid, integer, uuid, text, text, timestamp with time zone) FROM crm_app;
REVOKE EXECUTE ON FUNCTION reserve_deployment_seat(text, text, timestamp with time zone, timestamp with time zone) FROM crm_app;
REVOKE EXECUTE ON FUNCTION activate_deployment_seat(text, text, text, timestamp with time zone) FROM crm_app;
REVOKE EXECUTE ON FUNCTION release_deployment_membership_seat(text, timestamp with time zone) FROM crm_app;
REVOKE EXECUTE ON FUNCTION release_deployment_invitation_seat(text, timestamp with time zone) FROM crm_app;
GRANT EXECUTE ON FUNCTION reserve_deployment_invitation(uuid, text, text, uuid, integer, text, text, text, timestamp with time zone, timestamp with time zone) TO crm_app;
GRANT EXECUTE ON FUNCTION bootstrap_deployment_invitation(uuid, text, text, uuid, integer, text, timestamp with time zone, timestamp with time zone) TO crm_app;
GRANT EXECUTE ON FUNCTION activate_deployment_membership(text, text, text, uuid, integer, uuid, text, text, boolean, timestamp with time zone) TO crm_app;
GRANT EXECUTE ON FUNCTION consume_deployment_invitation(text, uuid, text, text, timestamp with time zone) TO crm_app;
GRANT EXECUTE ON FUNCTION auto_join_deployment_membership(text, text, text, uuid, integer, timestamp with time zone) TO crm_app;
GRANT EXECUTE ON FUNCTION bootstrap_deployment_owner(text, text, text, uuid, integer, text, timestamp with time zone) TO crm_app;
GRANT EXECUTE ON FUNCTION change_deployment_membership(text, text, boolean, text, text, timestamp with time zone) TO crm_app;
GRANT EXECUTE ON FUNCTION revoke_deployment_invitation(text, uuid, text, text, timestamp with time zone) TO crm_app;
GRANT EXECUTE ON FUNCTION reconcile_expired_deployment_seat_reservations(timestamp with time zone) TO crm_app;

-- verify_api_key: safe pre-tenant key lookup for the REST API v1 auth layer.
-- Runs BEFORE app.current_tenant is known, so it is SECURITY DEFINER (owned by
-- the migrating superuser => bypasses api_keys RLS for THIS query only). It
-- returns ONLY the minimal (organization_id, member_id) tuple needed to set the
-- tenant GUC, stamps last_used_at, and ignores revoked keys. search_path is
-- pinned to '' and every object is schema-qualified (public.api_keys,
-- pg_catalog.now) so a crm_app SQL foothold cannot shadow api_keys via pg_temp
-- and impersonate a tenant. Depends on the definer being a superuser that
-- bypasses RLS; if that ever changes it fails closed (returns nothing). EXECUTE is revoked
-- from PUBLIC and granted solely to the non-privileged crm_app role.
-- Return type is (text, text) because organization.id / member.id are text.
DROP FUNCTION IF EXISTS verify_api_key(text);
CREATE FUNCTION verify_api_key(p_hash text)
RETURNS TABLE(organization_id text, member_id text)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.api_keys
     SET last_used_at = pg_catalog.now()
   WHERE key_hash = p_hash AND revoked_at IS NULL
  RETURNING organization_id, member_id;
$$;
REVOKE ALL ON FUNCTION verify_api_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_api_key(text) TO crm_app;
