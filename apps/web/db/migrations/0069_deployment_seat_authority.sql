ALTER TABLE deployment_seat_state
  ADD COLUMN last_reconciled_at timestamp with time zone DEFAULT '1970-01-01T00:00:00Z' NOT NULL;
--> statement-breakpoint
CREATE TABLE deployment_bootstrap_state (
  singleton smallint PRIMARY KEY DEFAULT 1 NOT NULL CHECK (singleton = 1),
  configured_owner_email text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT deployment_bootstrap_owner_email_check CHECK (
    configured_owner_email IS NULL OR (
      configured_owner_email = pg_catalog.lower(pg_catalog.btrim(configured_owner_email))
      AND configured_owner_email !~ '[[:cntrl:][:space:]]'
      AND length(configured_owner_email) BETWEEN 3 AND 320
    )
  )
);
INSERT INTO deployment_bootstrap_state (singleton) VALUES (1);
ALTER TABLE deployment_bootstrap_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_bootstrap_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON deployment_bootstrap_state FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER pending_invites_deployment_seat_guard ON pending_invites;
DROP TRIGGER membership_profiles_deployment_seat_guard ON membership_profiles;
DROP FUNCTION enforce_deployment_seat_mutation();
--> statement-breakpoint
CREATE FUNCTION require_deployment_seat_actor(
  p_tenant_id text,
  p_actor_user_id text,
  p_actor_member_id text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_member_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.member actor_member
    JOIN public.membership_profiles actor_profile
      ON actor_profile.member_id = actor_member.id
      AND actor_profile.tenant_id = actor_member.organization_id
    WHERE actor_member.id = p_actor_member_id
      AND actor_member.organization_id = p_tenant_id
      AND actor_member.user_id = p_actor_user_id
      AND actor_profile.status = 'active'
      AND (
        EXISTS (
          SELECT 1 FROM public.roles actor_role
          WHERE actor_role.id = actor_profile.role_id
            AND actor_role.tenant_id = p_tenant_id
            AND actor_role.is_system = true
            AND actor_role.name IN ('Owner', 'Admin')
        ) OR EXISTS (
          SELECT 1
          FROM public.member_roles actor_assignment
          JOIN public.roles actor_role ON actor_role.id = actor_assignment.role_id
          WHERE actor_assignment.member_id = actor_member.id
            AND actor_assignment.tenant_id = p_tenant_id
            AND actor_role.tenant_id = p_tenant_id
            AND actor_role.is_system = true
            AND actor_role.name IN ('Owner', 'Admin')
        )
      )
  ) THEN
    RAISE EXCEPTION 'deployment seat mutation requires an authenticated active Owner or Admin';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION perform_deployment_invitation_reservation(
  p_invitation_id uuid,
  p_tenant_id text,
  p_normalized_email text,
  p_role_id uuid,
  p_tier_level integer,
  p_invited_by_member_id text,
  p_actor_user_id text,
  p_actor_member_id text,
  p_expires_at timestamp with time zone,
  p_now timestamp with time zone
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
    ) ON CONFLICT (tenant_id, normalized_email) DO UPDATE SET
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
CREATE FUNCTION reserve_deployment_invitation(
  p_invitation_id uuid, p_tenant_id text, p_normalized_email text, p_role_id uuid,
  p_tier_level integer, p_invited_by_member_id text, p_actor_user_id text,
  p_actor_member_id text, p_expires_at timestamp with time zone,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  effective_invitation_id uuid, allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  PERFORM public.require_deployment_seat_actor(p_tenant_id, p_actor_user_id, p_actor_member_id);
  RETURN QUERY SELECT * FROM public.perform_deployment_invitation_reservation(
    p_invitation_id, p_tenant_id, p_normalized_email, p_role_id, p_tier_level,
    p_invited_by_member_id, p_actor_user_id, p_actor_member_id, p_expires_at, p_now
  );
END;
$$;
--> statement-breakpoint
CREATE FUNCTION bootstrap_deployment_invitation(
  p_invitation_id uuid, p_tenant_id text, p_normalized_email text, p_role_id uuid,
  p_tier_level integer, p_actor_user_id text, p_expires_at timestamp with time zone,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  effective_invitation_id uuid, allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public."user" actor WHERE actor.id = p_actor_user_id AND actor.is_superadmin = true
  ) OR EXISTS (
    SELECT 1 FROM public.membership_profiles profile
    WHERE profile.tenant_id = p_tenant_id AND profile.status = 'active'
  ) THEN
    RAISE EXCEPTION 'entity invitation bootstrap requires a platform master and an unclaimed tenant';
  END IF;
  RETURN QUERY SELECT * FROM public.perform_deployment_invitation_reservation(
    p_invitation_id, p_tenant_id, p_normalized_email, p_role_id, p_tier_level,
    NULL, p_actor_user_id, NULL, p_expires_at, p_now
  );
END;
$$;
--> statement-breakpoint
CREATE FUNCTION perform_deployment_membership_activation(
  p_tenant_id text, p_user_id text, p_member_id text, p_role_id uuid,
  p_tier_level integer, p_invitation_id uuid, p_actor_user_id text,
  p_actor_member_id text, p_now timestamp with time zone
)
RETURNS TABLE(
  effective_member_id text, allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
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
  SELECT id INTO existing_member_id FROM public.member
    WHERE organization_id = p_tenant_id AND user_id = p_user_id LIMIT 1;
  chosen_member_id := COALESCE(existing_member_id, p_member_id);
  IF p_invitation_id IS NULL AND existing_member_id IS NOT NULL
    AND NOT target.is_vendor_support AND EXISTS (
      SELECT 1 FROM public.membership_profiles profile
      WHERE profile.member_id = existing_member_id AND profile.tenant_id = p_tenant_id
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
        WHERE profile.member_id = chosen_member_id AND profile.tenant_id = p_tenant_id
          AND profile.status = 'active'
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
CREATE FUNCTION activate_deployment_membership(
  p_tenant_id text, p_user_id text, p_member_id text, p_role_id uuid,
  p_tier_level integer, p_invitation_id uuid, p_actor_user_id text,
  p_actor_member_id text, p_require_empty_tenant boolean,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  effective_member_id text, allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_require_empty_tenant THEN
    RAISE EXCEPTION 'use the scoped deployment bootstrap authority';
  END IF;
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  PERFORM public.require_deployment_seat_actor(p_tenant_id, p_actor_user_id, p_actor_member_id);
  RETURN QUERY SELECT * FROM public.perform_deployment_membership_activation(
    p_tenant_id, p_user_id, p_member_id, p_role_id, p_tier_level, p_invitation_id,
    p_actor_user_id, p_actor_member_id, p_now
  );
END;
$$;
--> statement-breakpoint
CREATE FUNCTION consume_deployment_invitation(
  p_tenant_id text, p_invitation_id uuid, p_user_id text, p_member_id text,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  effective_member_id text, allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_user_id IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.pending_invites invite
      JOIN public."user" target
        ON pg_catalog.lower(pg_catalog.btrim(target.email)) = invite.normalized_email
      WHERE invite.id = p_invitation_id AND invite.tenant_id = p_tenant_id
        AND invite.expires_at > p_now AND target.id = p_user_id
    ) OR EXISTS (
      SELECT 1
      FROM public.deployment_seat_reservations reservation
      JOIN public.member existing
        ON existing.organization_id = p_tenant_id AND existing.user_id = p_user_id
      JOIN public.membership_profiles profile
        ON profile.member_id = existing.id AND profile.tenant_id = p_tenant_id
      WHERE reservation.invitation_id = p_invitation_id::text
        AND reservation.status = 'consumed'
        AND reservation.consumed_user_id = p_user_id
        AND profile.status = 'active'
    )
  ) THEN RAISE EXCEPTION 'deployment invitation consumption requires the invited user'; END IF;
  RETURN QUERY SELECT * FROM public.perform_deployment_membership_activation(
    p_tenant_id, p_user_id, p_member_id, NULL, 0, p_invitation_id, p_user_id, NULL, p_now
  );
END;
$$;
--> statement-breakpoint
CREATE FUNCTION auto_join_deployment_membership(
  p_tenant_id text, p_user_id text, p_member_id text, p_role_id uuid,
  p_tier_level integer, p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  effective_member_id text, allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_email text; target_domain text;
BEGIN
  SELECT pg_catalog.lower(pg_catalog.btrim(email)) INTO target_email FROM public."user" WHERE id = p_user_id;
  target_domain := pg_catalog.split_part(target_email, '@', 2);
  IF target_email IS NULL OR target_domain = '' OR NOT EXISTS (
    SELECT 1 FROM public.tenant_settings settings
    JOIN public.roles role ON role.id = p_role_id AND role.tenant_id = settings.organization_id
    WHERE settings.organization_id = p_tenant_id
      AND settings.auto_join_domains @> pg_catalog.jsonb_build_array(target_domain)
      AND role.name = COALESCE(settings.auto_join_role, 'Rep')
  ) THEN RAISE EXCEPTION 'deployment auto-join does not match tenant policy'; END IF;
  RETURN QUERY SELECT * FROM public.perform_deployment_membership_activation(
    p_tenant_id, p_user_id, p_member_id, p_role_id, p_tier_level, NULL, p_user_id, NULL, p_now
  );
END;
$$;
--> statement-breakpoint
CREATE FUNCTION bootstrap_deployment_owner(
  p_tenant_id text, p_user_id text, p_member_id text, p_role_id uuid,
  p_tier_level integer, p_mode text,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  effective_member_id text, allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_email text;
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  SELECT pg_catalog.lower(pg_catalog.btrim(email)) INTO target_email FROM public."user" WHERE id = p_user_id;
  IF target_email IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.roles role WHERE role.id = p_role_id AND role.tenant_id = p_tenant_id
      AND role.name = 'Owner' AND role.is_system = true
  ) THEN RAISE EXCEPTION 'deployment bootstrap requires an Owner role and existing user'; END IF;
  IF p_mode = 'empty' THEN
    IF EXISTS (
      SELECT 1 FROM public.member existing
      WHERE existing.organization_id = p_tenant_id AND existing.user_id <> p_user_id
    ) THEN RAISE EXCEPTION 'bootstrap tenant is already claimed'; END IF;
  ELSIF p_mode = 'configured' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.deployment_bootstrap_state state
      WHERE state.singleton = 1 AND state.configured_owner_email = target_email
    ) THEN RAISE EXCEPTION 'configured bootstrap owner does not match'; END IF;
  ELSE
    RAISE EXCEPTION 'invalid deployment bootstrap mode';
  END IF;
  RETURN QUERY SELECT * FROM public.perform_deployment_membership_activation(
    p_tenant_id, p_user_id, p_member_id, p_role_id, p_tier_level, NULL, p_user_id, NULL, p_now
  );
END;
$$;
--> statement-breakpoint
CREATE FUNCTION change_deployment_membership(
  p_tenant_id text, p_member_id text, p_remove boolean, p_actor_user_id text,
  p_actor_member_id text, p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE decision record; profile_status public.member_status; counts record; access record;
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  PERFORM * FROM public.read_deployment_entitlement_state(p_now);
  PERFORM public.require_deployment_seat_actor(p_tenant_id, p_actor_user_id, p_actor_member_id);
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
        WHERE assignment.member_id = profile.member_id AND role.name = 'Owner' AND role.is_system = true)
    )
  ) AND (
    SELECT pg_catalog.count(DISTINCT owner.member_id)
    FROM public.membership_profiles owner
    WHERE owner.tenant_id = p_tenant_id AND owner.status = 'active' AND (
      EXISTS (SELECT 1 FROM public.roles role
        WHERE role.id = owner.role_id AND role.name = 'Owner' AND role.is_system = true)
      OR EXISTS (SELECT 1 FROM public.member_roles assignment
        JOIN public.roles role ON role.id = assignment.role_id
        WHERE assignment.member_id = owner.member_id AND role.name = 'Owner' AND role.is_system = true)
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
  p_tenant_id text, p_invitation_id uuid, p_actor_user_id text,
  p_actor_member_id text, p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE decision record; counts record; access record;
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  PERFORM * FROM public.read_deployment_entitlement_state(p_now);
  PERFORM public.require_deployment_seat_actor(p_tenant_id, p_actor_user_id, p_actor_member_id);
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
    INSERT INTO public.audit_log (tenant_id, actor_user_id, actor_member_id, action, entity_type, entity_id)
    VALUES (p_tenant_id, p_actor_user_id, p_actor_member_id,
      'member.invite_revoked', 'pending_invite', p_invitation_id::text);
  END IF;
  RETURN QUERY SELECT decision.allowed, decision.reason, decision.occupied_user_count,
    decision.reserved_invitation_count, decision.seat_limit, decision.overage;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reconcile_expired_deployment_seat_reservations(
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(expired_count bigint, occupied_user_count bigint, reserved_invitation_count bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed bigint; counts record; expired_ids text[];
BEGIN
  PERFORM 1 FROM public.deployment_seat_state WHERE singleton = 1 FOR UPDATE;
  WITH candidates AS (
    SELECT reservation.invitation_id
    FROM public.deployment_seat_reservations reservation
    WHERE reservation.status IN ('reserved', 'expired') AND reservation.expires_at <= p_now
      AND EXISTS (
        SELECT 1 FROM public.pending_invites invite WHERE invite.id::text = reservation.invitation_id
      )
    ORDER BY reservation.expires_at, reservation.invitation_id
    LIMIT 500 FOR UPDATE OF reservation SKIP LOCKED
  ), expired AS (
    UPDATE public.deployment_seat_reservations reservation
    SET status = 'expired', expired_at = COALESCE(reservation.expired_at, p_now), updated_at = p_now,
      consumed_user_id = NULL, consumed_at = NULL, released_at = NULL
    FROM candidates WHERE reservation.invitation_id = candidates.invitation_id
    RETURNING reservation.invitation_id
  ) SELECT pg_catalog.count(*), pg_catalog.array_agg(invitation_id) INTO changed, expired_ids FROM expired;
  INSERT INTO public.audit_log (tenant_id, action, entity_type, entity_id, after)
  SELECT invite.tenant_id, 'member.invite_expired', 'pending_invite', invite.id::text,
    pg_catalog.jsonb_build_object('expiresAt', invite.expires_at)
  FROM public.pending_invites invite
  WHERE invite.id::text = ANY(COALESCE(expired_ids, ARRAY[]::text[]));
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
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
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
UPDATE deployment_runtime_metadata SET migration_version = '0069', published_at = now() WHERE singleton = 1;
--> statement-breakpoint
REVOKE ALL ON deployment_bootstrap_state FROM PUBLIC;
REVOKE ALL ON FUNCTION require_deployment_seat_actor(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION perform_deployment_invitation_reservation(uuid, text, text, uuid, integer, text, text, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION perform_deployment_membership_activation(text, text, text, uuid, integer, uuid, text, text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_deployment_seat(text, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION activate_deployment_seat(text, text, text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_deployment_membership_seat(text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_deployment_invitation_seat(text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_deployment_invitation(uuid, text, text, uuid, integer, text, text, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION bootstrap_deployment_invitation(uuid, text, text, uuid, integer, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION activate_deployment_membership(text, text, text, uuid, integer, uuid, text, text, boolean, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_deployment_invitation(text, uuid, text, text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION auto_join_deployment_membership(text, text, text, uuid, integer, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION bootstrap_deployment_owner(text, text, text, uuid, integer, text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION change_deployment_membership(text, text, boolean, text, text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_deployment_invitation(text, uuid, text, text, timestamp with time zone) FROM PUBLIC;
