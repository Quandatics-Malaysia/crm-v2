import "server-only"
import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import {
  roles,
  rolePermissions,
  permissions,
  tenantSettings,
  pipelines,
  pipelineStages,
  taxSettings,
} from "@/db/schema"
import { ROLE_TEMPLATES, ALL_PERMISSION_KEYS } from "@/lib/permissions"
import { CANONICAL_STAGES } from "@/lib/funnel-stages"

const DEFAULT_INDUSTRIES = [
  "Agriculture",
  "Construction",
  "Consulting",
  "Education",
  "Energy",
  "Finance",
  "Government",
  "Healthcare",
  "Manufacturing",
  "Real Estate",
  "Retail",
  "Technology",
  "Telecommunications",
  "Transportation",
  "Other",
]

/**
 * Seed a tenant with its default configuration: settings, roles + permissions,
 * the canonical funnel + stages, and a default tax rate. Idempotent. Returns
 * the Owner role id (for provisioning the creator's membership profile).
 * Used by both the DB seed and the in-app "create entity" flow.
 */
export async function seedTenant(
  tx: Tx,
  tenantId: string,
  opts: { entityCode?: string; currency?: string } = {}
): Promise<string | null> {
  // global permission catalog
  await tx
    .insert(permissions)
    .values(ALL_PERMISSION_KEYS.map((key) => ({ key })))
    .onConflictDoNothing()
  const permRows = await tx.select().from(permissions)
  const permId = new Map(permRows.map((p) => [p.key, p.id]))

  // tenant settings
  await tx
    .insert(tenantSettings)
    .values({
      organizationId: tenantId,
      entityCode: opts.entityCode?.trim().toUpperCase() || null,
      defaultCurrency: opts.currency ?? "MYR",
      // Self-service tenants must be able to sign in out of the box; SSO-only is
      // opt-in. Without this a freshly-provisioned admin is hard-locked out.
      allowPasswordLogin: true,
      industries: DEFAULT_INDUSTRIES,
    })
    .onConflictDoNothing()

  // roles
  for (const rt of ROLE_TEMPLATES) {
    await tx
      .insert(roles)
      .values({
        tenantId,
        name: rt.name,
        description: rt.description,
        isSystem: true,
        defaultTierLevel: rt.tier,
      })
      .onConflictDoNothing()
  }
  const roleRows = await tx.select().from(roles).where(eq(roles.tenantId, tenantId))
  const roleId = new Map(roleRows.map((r) => [r.name, r.id]))

  for (const rt of ROLE_TEMPLATES) {
    const rid = roleId.get(rt.name)
    if (!rid) continue
    const keys = rt.permissions === "*" ? ALL_PERMISSION_KEYS : rt.permissions
    const values = keys
      .map((k) => ({ tenantId, roleId: rid, permissionId: permId.get(k) }))
      .filter((v): v is { tenantId: string; roleId: string; permissionId: string } =>
        Boolean(v.permissionId)
      )
    if (values.length) await tx.insert(rolePermissions).values(values).onConflictDoNothing()
  }

  // default funnel + canonical stages (only if none exist)
  const existing = await tx
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(eq(pipelines.tenantId, tenantId))
    .limit(1)
  if (existing.length === 0) {
    const [funnel] = await tx
      .insert(pipelines)
      .values({ tenantId, name: "Sales Funnel", isDefault: true, isActive: true })
      .returning()
    await tx.insert(pipelineStages).values(
      CANONICAL_STAGES.map((s) => ({
        tenantId,
        pipelineId: funnel.id,
        code: s.code,
        name: s.name,
        probability: String(s.probability),
        kind: s.kind,
        sortOrder: s.sortOrder,
        requiresApprovalToEnter: s.requiresApprovalToEnter,
        includeInForecast: s.includeInForecast,
      }))
    )
    await tx.insert(taxSettings).values({
      tenantId,
      name: "SST 6%",
      ratePercent: "6.000",
      isDefault: true,
      isActive: true,
    })
  }

  return roleId.get("Owner") ?? null
}
