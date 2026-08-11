ALTER TABLE "user" ADD COLUMN "is_vendor_support" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
DO $$
DECLARE duplicate_emails text;
BEGIN
  SELECT pg_catalog.string_agg(canonical_email, ', ' ORDER BY canonical_email)
  INTO duplicate_emails
  FROM (
    SELECT pg_catalog.lower(pg_catalog.btrim(email)) AS canonical_email
    FROM public."user"
    GROUP BY pg_catalog.lower(pg_catalog.btrim(email))
    HAVING pg_catalog.count(*) > 1
  ) duplicates;
  IF duplicate_emails IS NOT NULL THEN
    RAISE EXCEPTION 'canonical user email duplicates must be resolved before migration: %', duplicate_emails;
  END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_email_canonical_check" CHECK (
  email = pg_catalog.btrim(email)
  AND email !~ '[[:cntrl:][:space:]]'
  AND length(email) BETWEEN 3 AND 320
);
CREATE UNIQUE INDEX "user_email_canonical_uq" ON "user" (pg_catalog.lower(pg_catalog.btrim(email)));
--> statement-breakpoint
ALTER TABLE pending_invites ADD COLUMN normalized_email text;
ALTER TABLE pending_invites ADD COLUMN expires_at timestamp with time zone;
UPDATE pending_invites SET
  email = pg_catalog.btrim(email),
  normalized_email = pg_catalog.lower(pg_catalog.btrim(email)),
  expires_at = created_at + interval '7 days';
DO $$
DECLARE duplicate_invites text;
BEGIN
  SELECT pg_catalog.string_agg(tenant_id || ':' || normalized_email, ', ' ORDER BY tenant_id, normalized_email)
  INTO duplicate_invites
  FROM (
    SELECT tenant_id, normalized_email
    FROM public.pending_invites
    GROUP BY tenant_id, normalized_email
    HAVING pg_catalog.count(*) > 1
  ) duplicates;
  IF duplicate_invites IS NOT NULL THEN
    RAISE EXCEPTION 'canonical pending invite duplicates must be resolved before migration: %', duplicate_invites;
  END IF;
END;
$$;
ALTER TABLE pending_invites ALTER COLUMN normalized_email SET NOT NULL;
ALTER TABLE pending_invites ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE pending_invites ADD CONSTRAINT "pending_invites_email_canonical_check" CHECK (
  email = pg_catalog.btrim(email)
  AND normalized_email = pg_catalog.lower(pg_catalog.btrim(email))
  AND normalized_email !~ '[[:cntrl:][:space:]]'
  AND length(normalized_email) BETWEEN 3 AND 320
);
DROP INDEX pending_invites_email_uq;
CREATE UNIQUE INDEX "pending_invites_email_uq" ON pending_invites (tenant_id, normalized_email);
CREATE INDEX "pending_invites_expiry_idx" ON pending_invites (expires_at, normalized_email);
--> statement-breakpoint
ALTER TABLE deployment_seat_reservations ADD COLUMN consumed_user_id text REFERENCES "user"(id) ON DELETE SET NULL;
ALTER TABLE deployment_seat_reservations ADD COLUMN consumed_at timestamp with time zone;
ALTER TABLE deployment_seat_reservations ADD COLUMN released_at timestamp with time zone;
ALTER TABLE deployment_seat_reservations ADD COLUMN expired_at timestamp with time zone;
UPDATE deployment_seat_reservations SET released_at = updated_at WHERE status = 'released';
UPDATE deployment_seat_reservations SET expired_at = updated_at WHERE status = 'expired';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.deployment_seat_reservations WHERE status = 'consumed') THEN
    RAISE EXCEPTION 'legacy consumed seat reservations require consumed_user_id reconciliation before migration';
  END IF;
END;
$$;
ALTER TABLE deployment_seat_reservations ADD CONSTRAINT "deployment_seat_reservations_lifecycle_check" CHECK (
  (status = 'reserved' AND consumed_user_id IS NULL AND consumed_at IS NULL AND released_at IS NULL AND expired_at IS NULL)
  OR (status = 'consumed' AND consumed_at IS NOT NULL AND consumed_user_id IS NOT NULL AND released_at IS NULL AND expired_at IS NULL)
  OR (status = 'released' AND consumed_user_id IS NULL AND released_at IS NOT NULL AND consumed_at IS NULL AND expired_at IS NULL)
  OR (status = 'expired' AND consumed_user_id IS NULL AND expired_at IS NOT NULL AND consumed_at IS NULL AND released_at IS NULL)
);
INSERT INTO deployment_seat_reservations (invitation_id, normalized_email, status, expires_at, created_at, updated_at)
SELECT id::text, normalized_email, 'reserved', expires_at, created_at, updated_at
FROM pending_invites
ON CONFLICT (invitation_id) DO UPDATE SET
  normalized_email = excluded.normalized_email,
  status = 'reserved',
  expires_at = excluded.expires_at,
  updated_at = excluded.updated_at,
  consumed_user_id = NULL, consumed_at = NULL, released_at = NULL, expired_at = NULL;
--> statement-breakpoint
CREATE TABLE deployment_seat_state (
  singleton smallint PRIMARY KEY DEFAULT 1 NOT NULL CHECK (singleton = 1),
  last_reconciled_at timestamp with time zone DEFAULT '1970-01-01T00:00:00Z' NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
INSERT INTO deployment_seat_state (singleton) VALUES (1);
ALTER TABLE deployment_seat_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_seat_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON deployment_seat_state FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION lock_deployment_seat_state_before_control_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER deployment_control_state_seat_lock
BEFORE INSERT OR UPDATE ON deployment_control_state
FOR EACH ROW EXECUTE FUNCTION lock_deployment_seat_state_before_control_write();
--> statement-breakpoint
CREATE FUNCTION deployment_seat_snapshot(
  p_now timestamp with time zone,
  p_excluded_member_id text DEFAULT NULL,
  p_added_user_id text DEFAULT NULL,
  p_replaced_invitation_id text DEFAULT NULL,
  p_added_reservation_email text DEFAULT NULL
)
RETURNS TABLE(occupied_user_count bigint, reserved_invitation_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH projected_active AS (
    SELECT DISTINCT active_user.id AS user_id,
      pg_catalog.lower(pg_catalog.btrim(active_user.email)) AS normalized_email
    FROM public.membership_profiles profile
    JOIN public.member active_member ON active_member.id = profile.member_id
    JOIN public."user" active_user ON active_user.id = active_member.user_id
    WHERE profile.status = 'active'
      AND active_user.is_superadmin IS NOT TRUE
      AND active_user.is_vendor_support IS NOT TRUE
      AND (p_excluded_member_id IS NULL OR profile.member_id <> p_excluded_member_id)
    UNION
    SELECT added_user.id, pg_catalog.lower(pg_catalog.btrim(added_user.email))
    FROM public."user" added_user
    WHERE added_user.id = p_added_user_id
      AND added_user.is_superadmin IS NOT TRUE
      AND added_user.is_vendor_support IS NOT TRUE
  ), projected_reservations AS (
    SELECT reservation.normalized_email
    FROM public.deployment_seat_reservations reservation
    WHERE reservation.status = 'reserved'
      AND reservation.expires_at > p_now
      AND (p_replaced_invitation_id IS NULL OR reservation.invitation_id <> p_replaced_invitation_id)
    UNION ALL
    SELECT p_added_reservation_email WHERE p_added_reservation_email IS NOT NULL
  )
  SELECT
    (SELECT pg_catalog.count(DISTINCT user_id) FROM projected_active)::bigint,
    (
      SELECT pg_catalog.count(DISTINCT reservation.normalized_email)
      FROM projected_reservations reservation
      WHERE NOT EXISTS (
        SELECT 1 FROM projected_active active
        WHERE active.normalized_email = reservation.normalized_email
      )
    )::bigint;
$$;
--> statement-breakpoint
CREATE FUNCTION deployment_seat_access(p_now timestamp with time zone)
RETURNS TABLE(access_mode text, write_allowed boolean, seat_limit integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    CASE
      WHEN state.current_revision = 0 THEN 'unknown'
      WHEN state.subscription_status NOT IN ('active', 'past_due') THEN 'read_only'
      WHEN GREATEST(p_now, state.greatest_trusted_at) < state.contract_starts_at
        OR GREATEST(p_now, state.greatest_trusted_at) >= state.contract_ends_at
        OR GREATEST(p_now, state.greatest_trusted_at) > state.grace_until THEN 'read_only'
      WHEN GREATEST(p_now, state.greatest_trusted_at) <= state.lease_expires_at THEN 'active'
      ELSE 'grace'
    END,
    state.current_revision > 0
      AND state.subscription_status IN ('active', 'past_due')
      AND GREATEST(p_now, state.greatest_trusted_at) >= state.contract_starts_at
      AND GREATEST(p_now, state.greatest_trusted_at) < state.contract_ends_at
      AND GREATEST(p_now, state.greatest_trusted_at) <= state.grace_until,
    COALESCE(state.seat_limit, 0)
  FROM public.deployment_control_state state
  WHERE state.singleton = 1;
$$;
--> statement-breakpoint
CREATE FUNCTION read_deployment_seat_usage(p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp())
RETURNS TABLE(
  occupied_user_count bigint,
  reserved_invitation_count bigint,
  seat_limit integer,
  access_mode text,
  write_allowed boolean,
  overage boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE counts record; access record;
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  PERFORM * FROM public.read_deployment_entitlement_state(p_now);
  SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now);
  SELECT * INTO access FROM public.deployment_seat_access(p_now);
  RETURN QUERY SELECT counts.occupied_user_count, counts.reserved_invitation_count,
    access.seat_limit, access.access_mode, access.write_allowed,
    counts.occupied_user_count + counts.reserved_invitation_count > access.seat_limit;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION reserve_deployment_seat(
  p_invitation_id text,
  p_normalized_email text,
  p_expires_at timestamp with time zone,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE counts record; access record; decision boolean; decision_reason text;
BEGIN
  IF p_normalized_email <> pg_catalog.lower(pg_catalog.btrim(p_normalized_email))
    OR p_normalized_email ~ '[[:cntrl:][:space:]]'
    OR length(p_normalized_email) NOT BETWEEN 3 AND 320
    OR p_expires_at <= p_now THEN
    RAISE EXCEPTION 'invalid deployment seat reservation';
  END IF;
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  PERFORM * FROM public.read_deployment_entitlement_state(p_now);
  UPDATE public.deployment_seat_reservations SET status = 'expired', expired_at = p_now, updated_at = p_now
    WHERE status = 'reserved' AND expires_at <= p_now;
  SELECT * INTO access FROM public.deployment_seat_access(p_now);
  SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now, NULL, NULL, p_invitation_id, p_normalized_email);
  decision := access.write_allowed AND counts.occupied_user_count + counts.reserved_invitation_count <= access.seat_limit;
  decision_reason := CASE WHEN NOT access.write_allowed THEN access.access_mode
    WHEN NOT decision THEN 'seat_limit' ELSE 'allowed' END;
  IF decision THEN
    INSERT INTO public.deployment_seat_reservations (
      invitation_id, normalized_email, status, expires_at, created_at, updated_at,
      consumed_user_id, consumed_at, released_at, expired_at
    ) VALUES (p_invitation_id, p_normalized_email, 'reserved', p_expires_at, p_now, p_now, NULL, NULL, NULL, NULL)
    ON CONFLICT (invitation_id) DO UPDATE SET
      normalized_email = excluded.normalized_email, status = 'reserved', expires_at = excluded.expires_at,
      updated_at = excluded.updated_at, consumed_user_id = NULL, consumed_at = NULL, released_at = NULL, expired_at = NULL;
  END IF;
  RETURN QUERY SELECT decision, decision_reason, counts.occupied_user_count,
    counts.reserved_invitation_count, access.seat_limit,
    counts.occupied_user_count + counts.reserved_invitation_count > access.seat_limit;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION activate_deployment_seat(
  p_member_id text,
  p_user_id text,
  p_invitation_id text DEFAULT NULL,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE counts record; access record; decision boolean; decision_reason text; target record;
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  PERFORM * FROM public.read_deployment_entitlement_state(p_now);
  UPDATE public.deployment_seat_reservations SET status = 'expired', expired_at = p_now, updated_at = p_now
    WHERE status = 'reserved' AND expires_at <= p_now;
  SELECT id, is_superadmin, is_vendor_support INTO target FROM public."user" WHERE id = p_user_id;
  IF target.id IS NULL THEN RAISE EXCEPTION 'deployment seat user not found'; END IF;
  IF target.is_vendor_support THEN
    SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now);
    SELECT * INTO access FROM public.deployment_seat_access(p_now);
    RETURN QUERY SELECT false, 'vendor_support_no_membership'::text, counts.occupied_user_count,
      counts.reserved_invitation_count, access.seat_limit, false;
    RETURN;
  END IF;
  IF target.is_superadmin AND NOT EXISTS (
    SELECT 1 FROM public.member existing
    WHERE existing.id = p_member_id AND existing.user_id = p_user_id
  ) THEN
    SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now);
    SELECT * INTO access FROM public.deployment_seat_access(p_now);
    RETURN QUERY SELECT false, 'platform_master_existing_only'::text, counts.occupied_user_count,
      counts.reserved_invitation_count, access.seat_limit, false;
    RETURN;
  END IF;
  IF p_invitation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.deployment_seat_reservations reservation
    WHERE reservation.invitation_id = p_invitation_id
      AND ((reservation.status = 'reserved' AND reservation.expires_at > p_now)
        OR (reservation.status = 'consumed' AND reservation.consumed_user_id = p_user_id))
  ) THEN
    RAISE EXCEPTION 'deployment seat invitation is not live';
  END IF;
  SELECT * INTO access FROM public.deployment_seat_access(p_now);
  SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now, NULL, p_user_id, p_invitation_id, NULL);
  decision := access.write_allowed AND counts.occupied_user_count + counts.reserved_invitation_count <= access.seat_limit;
  decision_reason := CASE WHEN NOT access.write_allowed THEN access.access_mode
    WHEN NOT decision THEN 'seat_limit' ELSE 'allowed' END;
  IF decision THEN
    IF p_invitation_id IS NOT NULL THEN
      UPDATE public.deployment_seat_reservations SET status = 'consumed', consumed_user_id = p_user_id,
        consumed_at = p_now, updated_at = p_now, released_at = NULL, expired_at = NULL
      WHERE invitation_id = p_invitation_id AND status <> 'consumed';
    END IF;
  END IF;
  RETURN QUERY SELECT decision, decision_reason, counts.occupied_user_count,
    counts.reserved_invitation_count, access.seat_limit,
    counts.occupied_user_count + counts.reserved_invitation_count > access.seat_limit;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION release_deployment_membership_seat(
  p_member_id text,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE counts record; access record;
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  PERFORM * FROM public.read_deployment_entitlement_state(p_now);
  SELECT * INTO access FROM public.deployment_seat_access(p_now);
  SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now, p_member_id, NULL, NULL, NULL);
  IF access.write_allowed THEN
  END IF;
  RETURN QUERY SELECT access.write_allowed, CASE WHEN access.write_allowed THEN 'allowed' ELSE access.access_mode END,
    counts.occupied_user_count, counts.reserved_invitation_count, access.seat_limit,
    counts.occupied_user_count + counts.reserved_invitation_count > access.seat_limit;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION release_deployment_invitation_seat(
  p_invitation_id text,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE counts record; access record; current_status public.deployment_seat_reservation_status;
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  PERFORM * FROM public.read_deployment_entitlement_state(p_now);
  SELECT status INTO current_status FROM public.deployment_seat_reservations WHERE invitation_id = p_invitation_id;
  SELECT * INTO access FROM public.deployment_seat_access(p_now);
  SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now, NULL, NULL, p_invitation_id, NULL);
  IF current_status IN ('released', 'expired', 'consumed') OR current_status IS NULL THEN
    RETURN QUERY SELECT true, 'idempotent'::text, counts.occupied_user_count,
      counts.reserved_invitation_count, access.seat_limit,
      counts.occupied_user_count + counts.reserved_invitation_count > access.seat_limit;
    RETURN;
  END IF;
  IF access.write_allowed THEN
    UPDATE public.deployment_seat_reservations SET status = 'released', released_at = p_now,
      updated_at = p_now, consumed_user_id = NULL, consumed_at = NULL, expired_at = NULL
    WHERE invitation_id = p_invitation_id;
  END IF;
  RETURN QUERY SELECT access.write_allowed, CASE WHEN access.write_allowed THEN 'allowed' ELSE access.access_mode END,
    counts.occupied_user_count, counts.reserved_invitation_count, access.seat_limit,
    counts.occupied_user_count + counts.reserved_invitation_count > access.seat_limit;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION reserve_deployment_invitation(
  p_invitation_id uuid,
  p_tenant_id text,
  p_normalized_email text,
  p_role_id uuid,
  p_tier_level integer,
  p_invited_by_member_id text,
  p_actor_user_id text,
  p_actor_member_id text,
  p_expires_at timestamp with time zone,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  effective_invitation_id uuid, allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE decision record; chosen_id uuid; counts record; access record;
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  PERFORM * FROM public.read_deployment_entitlement_state(p_now);
  IF NOT EXISTS (SELECT 1 FROM public.organization WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'deployment seat tenant not found';
  END IF;
  IF p_role_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.roles WHERE id = p_role_id AND tenant_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'deployment seat role not found'; END IF;
  IF p_invited_by_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.member WHERE id = p_invited_by_member_id AND organization_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'deployment seat inviter not found'; END IF;
  IF p_actor_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.member WHERE id = p_actor_member_id AND organization_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'deployment seat actor not found'; END IF;
  SELECT invite.id INTO chosen_id FROM public.pending_invites invite
    WHERE invite.tenant_id = p_tenant_id AND invite.normalized_email = p_normalized_email LIMIT 1;
  chosen_id := COALESCE(chosen_id, p_invitation_id);
  IF chosen_id = p_invitation_id
    AND EXISTS (
      SELECT 1 FROM public.pending_invites invite
      WHERE invite.id = chosen_id AND invite.tenant_id = p_tenant_id
        AND invite.normalized_email = p_normalized_email AND invite.expires_at > p_now
    )
    AND EXISTS (
      SELECT 1 FROM public.deployment_seat_reservations reservation
      WHERE reservation.invitation_id = chosen_id::text
        AND reservation.normalized_email = p_normalized_email
        AND reservation.status = 'reserved' AND reservation.expires_at > p_now
    ) THEN
    SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now);
    SELECT * INTO access FROM public.deployment_seat_access(p_now);
    RETURN QUERY SELECT chosen_id, true, 'idempotent'::text, counts.occupied_user_count,
      counts.reserved_invitation_count, access.seat_limit,
      counts.occupied_user_count + counts.reserved_invitation_count > access.seat_limit;
    RETURN;
  END IF;
  SELECT * INTO decision FROM public.reserve_deployment_seat(
    chosen_id::text, p_normalized_email, p_expires_at, p_now
  );
  IF decision.allowed THEN
    INSERT INTO public.pending_invites (
      id, tenant_id, email, normalized_email, role_id, tier_level,
      invited_by_member_id, expires_at, created_at, updated_at
    ) VALUES (
      chosen_id, p_tenant_id, p_normalized_email, p_normalized_email, p_role_id,
      p_tier_level, p_invited_by_member_id, p_expires_at, p_now, p_now
    )
    ON CONFLICT (tenant_id, normalized_email) DO UPDATE SET
      email = excluded.email, role_id = excluded.role_id, tier_level = excluded.tier_level,
      invited_by_member_id = excluded.invited_by_member_id, expires_at = excluded.expires_at,
      updated_at = excluded.updated_at;
    INSERT INTO public.audit_log (
      tenant_id, actor_user_id, actor_member_id, action, entity_type, entity_id, after
    ) VALUES (
      p_tenant_id, p_actor_user_id, p_actor_member_id, 'member.invited',
      'pending_invite', chosen_id::text,
      pg_catalog.jsonb_build_object('roleId', p_role_id, 'expiresAt', p_expires_at)
    );
  END IF;
  RETURN QUERY SELECT chosen_id, decision.allowed, decision.reason, decision.occupied_user_count,
    decision.reserved_invitation_count, decision.seat_limit, decision.overage;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION activate_deployment_membership(
  p_tenant_id text,
  p_user_id text,
  p_member_id text,
  p_role_id uuid,
  p_tier_level integer,
  p_invitation_id uuid,
  p_actor_user_id text,
  p_actor_member_id text,
  p_require_empty_tenant boolean,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  effective_member_id text, allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  decision record; target record; existing_member_id text; chosen_member_id text; chosen_invitation_id uuid;
  chosen_role_id uuid := p_role_id; chosen_tier_level integer := p_tier_level;
  counts record; access record;
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  PERFORM * FROM public.read_deployment_entitlement_state(p_now);
  SELECT id, email, is_superadmin, is_vendor_support INTO target FROM public."user" WHERE id = p_user_id;
  IF target.id IS NULL THEN RAISE EXCEPTION 'deployment seat user not found'; END IF;
  IF p_role_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.roles WHERE id = p_role_id AND tenant_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'deployment seat role not found'; END IF;
  IF p_actor_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.member WHERE id = p_actor_member_id AND organization_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'deployment seat actor not found'; END IF;
  SELECT id INTO existing_member_id FROM public.member
    WHERE organization_id = p_tenant_id AND user_id = p_user_id LIMIT 1;
  chosen_member_id := COALESCE(existing_member_id, p_member_id);
  IF p_require_empty_tenant AND existing_member_id IS NOT NULL THEN
    IF NOT target.is_vendor_support AND EXISTS (
      SELECT 1 FROM public.membership_profiles profile
      WHERE profile.member_id = existing_member_id
        AND profile.tenant_id = p_tenant_id
        AND profile.status = 'active'
    ) THEN
      SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now);
      SELECT * INTO access FROM public.deployment_seat_access(p_now);
      RETURN QUERY SELECT existing_member_id, true, 'idempotent'::text, counts.occupied_user_count,
        counts.reserved_invitation_count, access.seat_limit,
        counts.occupied_user_count + counts.reserved_invitation_count > access.seat_limit;
      RETURN;
    END IF;
    RAISE EXCEPTION 'bootstrap tenant is already claimed';
  END IF;
  IF p_require_empty_tenant AND EXISTS (
    SELECT 1 FROM public.member WHERE organization_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'bootstrap tenant is already claimed'; END IF;
  IF p_invitation_id IS NULL AND existing_member_id IS NOT NULL
    AND NOT target.is_vendor_support AND EXISTS (
      SELECT 1 FROM public.membership_profiles profile
      WHERE profile.member_id = existing_member_id
        AND profile.tenant_id = p_tenant_id
        AND profile.status = 'active'
    ) THEN
    SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now);
    SELECT * INTO access FROM public.deployment_seat_access(p_now);
    RETURN QUERY SELECT existing_member_id, true, 'idempotent'::text, counts.occupied_user_count,
      counts.reserved_invitation_count, access.seat_limit,
      counts.occupied_user_count + counts.reserved_invitation_count > access.seat_limit;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.member WHERE id = chosen_member_id
      AND (organization_id <> p_tenant_id OR user_id <> p_user_id)
  ) THEN RAISE EXCEPTION 'deployment membership identity collision'; END IF;
  IF p_invitation_id IS NOT NULL THEN
    SELECT invite.id, invite.role_id, invite.tier_level
      INTO chosen_invitation_id, chosen_role_id, chosen_tier_level
      FROM public.pending_invites invite
      WHERE invite.id = p_invitation_id AND invite.tenant_id = p_tenant_id
        AND invite.normalized_email = pg_catalog.lower(pg_catalog.btrim(target.email))
        AND invite.expires_at > p_now;
    IF chosen_invitation_id IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.membership_profiles profile
        WHERE profile.member_id = chosen_member_id AND profile.tenant_id = p_tenant_id AND profile.status = 'active'
      ) THEN
        SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now);
        SELECT * INTO access FROM public.deployment_seat_access(p_now);
        RETURN QUERY SELECT chosen_member_id, true, 'idempotent'::text, counts.occupied_user_count,
          counts.reserved_invitation_count, access.seat_limit,
          counts.occupied_user_count + counts.reserved_invitation_count > access.seat_limit;
        RETURN;
      END IF;
      RAISE EXCEPTION 'deployment seat invitation is not live';
    END IF;
  ELSE
    SELECT invite.id INTO chosen_invitation_id FROM public.pending_invites invite
      WHERE invite.tenant_id = p_tenant_id
        AND invite.normalized_email = pg_catalog.lower(pg_catalog.btrim(target.email))
        AND invite.expires_at > p_now LIMIT 1;
  END IF;
  IF chosen_role_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.roles WHERE id = chosen_role_id AND tenant_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'deployment seat invitation role not found'; END IF;
  SELECT * INTO decision FROM public.activate_deployment_seat(
    chosen_member_id, p_user_id, chosen_invitation_id::text, p_now
  );
  IF decision.allowed THEN
    INSERT INTO public.member (id, organization_id, user_id, role, created_at)
      VALUES (chosen_member_id, p_tenant_id, p_user_id, 'member', p_now)
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.membership_profiles (
      member_id, tenant_id, role_id, tier_level, status, created_at, updated_at
    ) VALUES (
      chosen_member_id, p_tenant_id, chosen_role_id, chosen_tier_level, 'active', p_now, p_now
    ) ON CONFLICT (member_id) DO UPDATE SET
      role_id = excluded.role_id, tier_level = excluded.tier_level,
      status = 'active', updated_at = excluded.updated_at;
    DELETE FROM public.member_roles WHERE member_id = chosen_member_id;
    IF chosen_role_id IS NOT NULL THEN
      INSERT INTO public.member_roles (tenant_id, member_id, role_id)
        VALUES (p_tenant_id, chosen_member_id, chosen_role_id) ON CONFLICT DO NOTHING;
    END IF;
    IF chosen_invitation_id IS NOT NULL THEN
      DELETE FROM public.pending_invites WHERE id = chosen_invitation_id AND tenant_id = p_tenant_id;
    END IF;
    INSERT INTO public.audit_log (
      tenant_id, actor_user_id, actor_member_id, action, entity_type, entity_id, after
    ) VALUES (
      p_tenant_id, p_actor_user_id, p_actor_member_id,
      CASE WHEN p_invitation_id IS NULL THEN 'member.added' ELSE 'member.invite_consumed' END,
      'member', chosen_member_id, pg_catalog.jsonb_build_object('roleId', chosen_role_id)
    );
  END IF;
  RETURN QUERY SELECT chosen_member_id, decision.allowed, decision.reason, decision.occupied_user_count,
    decision.reserved_invitation_count, decision.seat_limit, decision.overage;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION change_deployment_membership(
  p_tenant_id text,
  p_member_id text,
  p_remove boolean,
  p_actor_user_id text,
  p_actor_member_id text,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE decision record; profile_status public.member_status; counts record; access record;
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  PERFORM * FROM public.read_deployment_entitlement_state(p_now);
  IF p_actor_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.member WHERE id = p_actor_member_id AND organization_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'deployment seat actor not found'; END IF;
  SELECT status INTO profile_status FROM public.membership_profiles
    WHERE member_id = p_member_id AND tenant_id = p_tenant_id;
  IF profile_status IS NULL OR (NOT p_remove AND profile_status = 'disabled') THEN
    SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now);
    SELECT * INTO access FROM public.deployment_seat_access(p_now);
    RETURN QUERY SELECT true, 'idempotent'::text, counts.occupied_user_count,
      counts.reserved_invitation_count, access.seat_limit,
      counts.occupied_user_count + counts.reserved_invitation_count > access.seat_limit;
    RETURN;
  END IF;
  IF profile_status = 'active' AND EXISTS (
    SELECT 1 FROM public.membership_profiles profile
    WHERE profile.member_id = p_member_id AND profile.tenant_id = p_tenant_id AND (
      EXISTS (SELECT 1 FROM public.roles role
        WHERE role.id = profile.role_id AND role.name = 'Owner' AND role.is_system = true)
      OR EXISTS (SELECT 1 FROM public.member_roles assignment
        JOIN public.roles role ON role.id = assignment.role_id
        WHERE assignment.member_id = profile.member_id
          AND role.name = 'Owner' AND role.is_system = true)
    )
  ) AND (
    SELECT pg_catalog.count(DISTINCT owner.member_id)
    FROM public.membership_profiles owner
    WHERE owner.tenant_id = p_tenant_id AND owner.status = 'active' AND (
      EXISTS (SELECT 1 FROM public.roles role
        WHERE role.id = owner.role_id AND role.name = 'Owner' AND role.is_system = true)
      OR EXISTS (SELECT 1 FROM public.member_roles assignment
        JOIN public.roles role ON role.id = assignment.role_id
        WHERE assignment.member_id = owner.member_id
          AND role.name = 'Owner' AND role.is_system = true)
    )
  ) = 1 THEN RAISE EXCEPTION 'cannot remove or disable the last Owner'; END IF;
  SELECT * INTO decision FROM public.release_deployment_membership_seat(p_member_id, p_now);
  IF decision.allowed THEN
    INSERT INTO public.audit_log (
      tenant_id, actor_user_id, actor_member_id, action, entity_type, entity_id, after
    ) VALUES (
      p_tenant_id, p_actor_user_id, p_actor_member_id,
      CASE WHEN p_remove THEN 'member.removed' ELSE 'member.status_changed' END,
      'member', p_member_id,
      CASE WHEN p_remove THEN NULL ELSE pg_catalog.jsonb_build_object('status', 'disabled') END
    );
    IF p_remove THEN
      DELETE FROM public.member_roles WHERE member_id = p_member_id AND tenant_id = p_tenant_id;
      DELETE FROM public.membership_profiles WHERE member_id = p_member_id AND tenant_id = p_tenant_id;
      DELETE FROM public.member WHERE id = p_member_id AND organization_id = p_tenant_id;
    ELSE
      UPDATE public.membership_profiles SET status = 'disabled', updated_at = p_now
        WHERE member_id = p_member_id AND tenant_id = p_tenant_id;
    END IF;
  END IF;
  RETURN QUERY SELECT decision.allowed, decision.reason, decision.occupied_user_count,
    decision.reserved_invitation_count, decision.seat_limit, decision.overage;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION revoke_deployment_invitation(
  p_tenant_id text,
  p_invitation_id uuid,
  p_actor_user_id text,
  p_actor_member_id text,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE decision record; counts record; access record;
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  PERFORM * FROM public.read_deployment_entitlement_state(p_now);
  IF p_actor_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.member WHERE id = p_actor_member_id AND organization_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'deployment seat actor not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pending_invites WHERE id = p_invitation_id AND tenant_id = p_tenant_id
  ) THEN
    SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now);
    SELECT * INTO access FROM public.deployment_seat_access(p_now);
    RETURN QUERY SELECT true, 'idempotent'::text, counts.occupied_user_count,
      counts.reserved_invitation_count, access.seat_limit,
      counts.occupied_user_count + counts.reserved_invitation_count > access.seat_limit;
    RETURN;
  END IF;
  SELECT * INTO decision FROM public.release_deployment_invitation_seat(p_invitation_id::text, p_now);
  IF decision.allowed THEN
    DELETE FROM public.pending_invites WHERE id = p_invitation_id AND tenant_id = p_tenant_id;
    INSERT INTO public.audit_log (
      tenant_id, actor_user_id, actor_member_id, action, entity_type, entity_id
    ) VALUES (
      p_tenant_id, p_actor_user_id, p_actor_member_id,
      'member.invite_revoked', 'pending_invite', p_invitation_id::text
    );
  END IF;
  RETURN QUERY SELECT decision.allowed, decision.reason, decision.occupied_user_count,
    decision.reserved_invitation_count, decision.seat_limit, decision.overage;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION reconcile_expired_deployment_seat_reservations(
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(expired_count bigint, occupied_user_count bigint, reserved_invitation_count bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE changed bigint; counts record; expired_ids text[];
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  WITH candidates AS (
    SELECT invitation_id FROM public.deployment_seat_reservations
    WHERE status = 'reserved' AND expires_at <= p_now
    ORDER BY expires_at, invitation_id LIMIT 500 FOR UPDATE SKIP LOCKED
  ), expired AS (
    UPDATE public.deployment_seat_reservations reservation
    SET status = 'expired', expired_at = p_now, updated_at = p_now
    FROM candidates WHERE reservation.invitation_id = candidates.invitation_id
    RETURNING reservation.invitation_id
  ) SELECT pg_catalog.count(*), pg_catalog.array_agg(invitation_id) INTO changed, expired_ids FROM expired;
  INSERT INTO public.audit_log (tenant_id, action, entity_type, entity_id, after)
  SELECT invite.tenant_id, 'member.invite_expired', 'pending_invite', invite.id::text,
    pg_catalog.jsonb_build_object('expiresAt', invite.expires_at)
  FROM public.pending_invites invite WHERE invite.id::text = ANY(COALESCE(expired_ids, ARRAY[]::text[]));
  DELETE FROM public.pending_invites invite
    WHERE invite.id::text = ANY(COALESCE(expired_ids, ARRAY[]::text[]));
  UPDATE public.deployment_seat_state SET last_reconciled_at = p_now, updated_at = p_now WHERE singleton = 1;
  SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now);
  RETURN QUERY SELECT changed, counts.occupied_user_count, counts.reserved_invitation_count;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION read_deployment_status_rollup()
RETURNS TABLE(active_user_count bigint, reserved_invitation_count bigint, applied_migration_version text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE usage record; observed_at timestamp with time zone := pg_catalog.statement_timestamp();
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.deployment_seat_state
    WHERE singleton = 1 AND last_reconciled_at <= observed_at - interval '15 minutes'
  ) THEN
    PERFORM * FROM public.reconcile_expired_deployment_seat_reservations(observed_at);
  END IF;
  SELECT * INTO usage FROM public.read_deployment_seat_usage(observed_at);
  RETURN QUERY SELECT usage.occupied_user_count, usage.reserved_invitation_count,
    (SELECT metadata.migration_version FROM public.deployment_runtime_metadata metadata WHERE metadata.singleton = 1);
END;
$$;
--> statement-breakpoint
UPDATE deployment_runtime_metadata SET migration_version = '0068', published_at = now() WHERE singleton = 1;
--> statement-breakpoint
REVOKE ALL ON deployment_seat_state FROM PUBLIC;
REVOKE ALL ON FUNCTION deployment_seat_snapshot(timestamp with time zone, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION deployment_seat_access(timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION read_deployment_seat_usage(timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_deployment_seat(text, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION activate_deployment_seat(text, text, text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_deployment_membership_seat(text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_deployment_invitation_seat(text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_deployment_invitation(uuid, text, text, uuid, integer, text, text, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION activate_deployment_membership(text, text, text, uuid, integer, uuid, text, text, boolean, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION change_deployment_membership(text, text, boolean, text, text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_deployment_invitation(text, uuid, text, text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION reconcile_expired_deployment_seat_reservations(timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION lock_deployment_seat_state_before_control_write() FROM PUBLIC;
