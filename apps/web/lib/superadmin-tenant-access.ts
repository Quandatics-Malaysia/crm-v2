export const SUPERADMIN_TENANT_COOKIE = "crm_superadmin_tenant"

type TenantAccessInput = {
  isSuperadmin: boolean
  tenantId: string | null | undefined
  memberTenantIds: readonly string[]
}

export function canSelectTenant({
  isSuperadmin,
  tenantId,
  memberTenantIds,
}: TenantAccessInput): boolean {
  if (!tenantId) return false
  return isSuperadmin || memberTenantIds.includes(tenantId)
}

export function resolveTenantId(input: {
  isSuperadmin: boolean
  requestedTenantId?: string | null
  sessionTenantId?: string | null
  memberTenantIds: readonly string[]
  organizationIds: readonly string[]
}): string | null {
  const candidates = [
    input.requestedTenantId,
    input.sessionTenantId,
    ...input.memberTenantIds,
    ...input.organizationIds,
  ]
  return (
    candidates.find(
      (tenantId): tenantId is string =>
        typeof tenantId === "string" &&
        input.organizationIds.includes(tenantId) &&
        canSelectTenant({
          isSuperadmin: input.isSuperadmin,
          tenantId,
          memberTenantIds: input.memberTenantIds,
        })
    ) ?? null
  )
}
