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
  IF p_actor_user_id IS NOT NULL AND p_actor_member_id IS NULL AND EXISTS (
    SELECT 1
    FROM public."user" actor
    WHERE actor.id = p_actor_user_id
      AND actor.email_verified = true
      AND actor.is_superadmin = true
      AND actor.is_vendor_support = false
  ) THEN
    RETURN;
  END IF;
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
