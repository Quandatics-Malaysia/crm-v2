ALTER TABLE organization
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN archived_at timestamp with time zone,
  ADD CONSTRAINT organization_status_check CHECK (status IN ('active', 'archived')),
  ADD CONSTRAINT organization_archive_timestamp_check CHECK (
    (status = 'active' AND archived_at IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL)
  );
--> statement-breakpoint
CREATE FUNCTION require_active_organization(p_tenant_id text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE target_status text;
BEGIN
  SELECT status INTO target_status FROM public.organization WHERE id = p_tenant_id FOR KEY SHARE;
  IF target_status IS NULL THEN
    RAISE EXCEPTION 'deployment seat tenant not found';
  END IF;
  IF target_status <> 'active' THEN
    RAISE EXCEPTION 'organization_archived';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION require_deployment_seat_actor(
  p_tenant_id text,
  p_actor_user_id text,
  p_actor_member_id text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.require_active_organization(p_tenant_id);
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
CREATE OR REPLACE FUNCTION deployment_seat_snapshot(
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
    JOIN public.organization active_organization
      ON active_organization.id = active_member.organization_id
      AND active_organization.status = 'active'
    JOIN public."user" active_user ON active_user.id = active_member.user_id
    WHERE profile.status = 'active'
      AND profile.tenant_id = active_organization.id
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
    JOIN public.pending_invites invite ON invite.id::text = reservation.invitation_id
    JOIN public.organization invite_organization
      ON invite_organization.id = invite.tenant_id
      AND invite_organization.status = 'active'
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
CREATE OR REPLACE FUNCTION bootstrap_deployment_invitation(
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
  PERFORM public.require_active_organization(p_tenant_id);
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
CREATE OR REPLACE FUNCTION consume_deployment_invitation(
  p_tenant_id text, p_invitation_id uuid, p_user_id text, p_member_id text,
  p_now timestamp with time zone DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE(
  effective_member_id text, allowed boolean, reason text, occupied_user_count bigint,
  reserved_invitation_count bigint, seat_limit integer, overage boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.require_active_organization(p_tenant_id);
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
CREATE OR REPLACE FUNCTION auto_join_deployment_membership(
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
  PERFORM public.require_active_organization(p_tenant_id);
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
CREATE OR REPLACE FUNCTION bootstrap_deployment_owner(
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
  PERFORM public.require_active_organization(p_tenant_id);
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
CREATE FUNCTION require_organization_operator(
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
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public."user" actor
    WHERE actor.id = p_actor_user_id AND actor.is_superadmin = true
  ) THEN
    RAISE EXCEPTION 'organization lifecycle mutation requires a server operator';
  END IF;
  IF p_actor_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.member actor_member
    WHERE actor_member.id = p_actor_member_id AND actor_member.user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'organization lifecycle operator member does not match server operator';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION archive_organization(
  p_tenant_id text,
  p_actor_user_id text,
  p_actor_member_id text,
  p_now timestamp with time zone
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE target_status text;
BEGIN
  SELECT status INTO target_status FROM public.organization WHERE id = p_tenant_id FOR UPDATE;
  IF target_status IS NULL THEN
    RAISE EXCEPTION 'organization not found';
  END IF;
  PERFORM public.require_organization_operator(p_tenant_id, p_actor_user_id, p_actor_member_id);
  IF target_status = 'archived' THEN
    RETURN;
  END IF;
  UPDATE public.organization SET status = 'archived', archived_at = p_now WHERE id = p_tenant_id;
  INSERT INTO public.audit_log (tenant_id, actor_user_id, actor_member_id, action, entity_type, entity_id, after)
  VALUES (
    p_tenant_id, p_actor_user_id, p_actor_member_id, 'organization.archived', 'organization', p_tenant_id,
    pg_catalog.jsonb_build_object('status', 'archived', 'archivedAt', p_now)
  );
END;
$$;
--> statement-breakpoint
CREATE FUNCTION restore_organization(
  p_tenant_id text,
  p_actor_user_id text,
  p_actor_member_id text,
  p_now timestamp with time zone
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE target_status text;
BEGIN
  SELECT status INTO target_status FROM public.organization WHERE id = p_tenant_id FOR UPDATE;
  IF target_status IS NULL THEN
    RAISE EXCEPTION 'organization not found';
  END IF;
  PERFORM public.require_organization_operator(p_tenant_id, p_actor_user_id, p_actor_member_id);
  IF target_status = 'active' THEN
    RETURN;
  END IF;
  UPDATE public.organization SET status = 'active', archived_at = NULL WHERE id = p_tenant_id;
  INSERT INTO public.audit_log (tenant_id, actor_user_id, actor_member_id, action, entity_type, entity_id, after)
  VALUES (
    p_tenant_id, p_actor_user_id, p_actor_member_id, 'organization.restored', 'organization', p_tenant_id,
    pg_catalog.jsonb_build_object('status', 'active', 'restoredAt', p_now)
  );
END;
$$;
--> statement-breakpoint
UPDATE deployment_runtime_metadata SET migration_version = '0070', published_at = now() WHERE singleton = 1;
--> statement-breakpoint
REVOKE ALL ON FUNCTION require_active_organization(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION require_organization_operator(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION archive_organization(text, text, text, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION restore_organization(text, text, text, timestamp with time zone) FROM PUBLIC;
