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
    PERFORM pg_catalog.set_config('app.deployment_seat_invitation_id', p_invitation_id, true);
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
      PERFORM pg_catalog.set_config('app.deployment_seat_invitation_id', p_invitation_id, true);
    END IF;
    PERFORM pg_catalog.set_config('app.deployment_seat_member_id', p_member_id, true);
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
    PERFORM pg_catalog.set_config('app.deployment_seat_member_id', p_member_id, true);
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
    PERFORM pg_catalog.set_config('app.deployment_seat_invitation_id', p_invitation_id, true);
  END IF;
  RETURN QUERY SELECT access.write_allowed, CASE WHEN access.write_allowed THEN 'allowed' ELSE access.access_mode END,
    counts.occupied_user_count, counts.reserved_invitation_count, access.seat_limit,
    counts.occupied_user_count + counts.reserved_invitation_count > access.seat_limit;
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
DECLARE changed bigint; counts record;
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  WITH expired AS (
    UPDATE public.deployment_seat_reservations SET status = 'expired', expired_at = p_now, updated_at = p_now
    WHERE status = 'reserved' AND expires_at <= p_now
    RETURNING invitation_id
  ) SELECT pg_catalog.count(*) INTO changed FROM expired;
  PERFORM pg_catalog.set_config('app.deployment_seat_reconcile', 'on', true);
  INSERT INTO public.audit_log (tenant_id, action, entity_type, entity_id, after)
  SELECT invite.tenant_id, 'member.invite_expired', 'pending_invite', invite.id::text,
    pg_catalog.jsonb_build_object('expiresAt', invite.expires_at)
  FROM public.pending_invites invite WHERE invite.expires_at <= p_now;
  DELETE FROM public.pending_invites invite WHERE invite.expires_at <= p_now;
  SELECT * INTO counts FROM public.deployment_seat_snapshot(p_now);
  RETURN QUERY SELECT changed, counts.occupied_user_count, counts.reserved_invitation_count;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION enforce_deployment_seat_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE target_id text;
BEGIN
  IF session_user <> 'crm_app' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'pending_invites' THEN
    target_id := COALESCE(NEW.id, OLD.id)::text;
    IF pg_catalog.current_setting('app.deployment_seat_reconcile', true) = 'on'
      OR pg_catalog.current_setting('app.deployment_seat_invitation_id', true) = target_id THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
  ELSE
    target_id := COALESCE(NEW.member_id, OLD.member_id);
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    IF pg_catalog.current_setting('app.deployment_seat_member_id', true) = target_id THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'deployment seat mutation must use deployment-seats authority';
END;
$$;
CREATE TRIGGER pending_invites_deployment_seat_guard
BEFORE INSERT OR UPDATE OR DELETE ON pending_invites
FOR EACH ROW EXECUTE FUNCTION enforce_deployment_seat_mutation();
CREATE TRIGGER membership_profiles_deployment_seat_guard
BEFORE INSERT OR DELETE OR UPDATE OF status ON membership_profiles
FOR EACH ROW EXECUTE FUNCTION enforce_deployment_seat_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION read_deployment_status_rollup()
RETURNS TABLE(active_user_count bigint, reserved_invitation_count bigint, applied_migration_version text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE usage record;
BEGIN
  SELECT * INTO usage FROM public.read_deployment_seat_usage(pg_catalog.statement_timestamp());
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
REVOKE ALL ON FUNCTION reconcile_expired_deployment_seat_reservations(timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_deployment_seat_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION lock_deployment_seat_state_before_control_write() FROM PUBLIC;
