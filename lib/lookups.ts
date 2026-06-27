import "server-only"
import { and, eq, isNull, asc } from "drizzle-orm"
import { db, runInTenant } from "@/db"
import {
  member,
  user,
  accounts,
  persons,
  funnels,
  funnelStages,
  taxSettings,
  tenantSettings,
} from "@/db/schema"
import { requireContext } from "@/lib/server-context"
import { visibleMemberIds, ownerScope } from "@/lib/access-scope"

export type MemberOption = { memberId: string; name: string; email: string }
export type Option = { id: string; name: string }

/** Members of the active tenant — for owner / assignee selects. */
export async function listMembers(): Promise<MemberOption[]> {
  const ctx = await requireContext()
  return db
    .select({ memberId: member.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, ctx.tenantId))
}

export async function listAccountOptions(): Promise<Option[]> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, async (tx) => {
    const visible = await visibleMemberIds(tx, ctx)
    return tx
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(
        and(
          isNull(accounts.deletedAt),
          ownerScope(accounts.ownerMemberId, visible)
        )
      )
      .orderBy(asc(accounts.name))
  })
}

export async function listPersonOptions(accountId?: string): Promise<Option[]> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, async (tx) => {
    const visible = await visibleMemberIds(tx, ctx)
    return tx
      .select({
        id: persons.id,
        name: persons.firstName,
      })
      .from(persons)
      .innerJoin(accounts, eq(persons.accountId, accounts.id))
      .where(
        and(
          isNull(persons.deletedAt),
          isNull(accounts.deletedAt),
          ownerScope(accounts.ownerMemberId, visible),
          accountId ? eq(persons.accountId, accountId) : undefined
        )
      )
      .orderBy(asc(persons.firstName))
  })
}

export type FunnelWithStages = {
  id: string
  name: string
  isDefault: boolean
  stages: {
    id: string
    code: string
    name: string
    kind: string
    sortOrder: number
    probability: string
    requiresApprovalToEnter: boolean
  }[]
}

export async function listFunnelsWithStages(): Promise<FunnelWithStages[]> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, async (tx) => {
    const fs = await tx
      .select()
      .from(funnels)
      .where(eq(funnels.tenantId, ctx.tenantId))
      .orderBy(asc(funnels.name))
    const stages = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.tenantId, ctx.tenantId))
      .orderBy(asc(funnelStages.sortOrder))
    return fs.map((f) => ({
      id: f.id,
      name: f.name,
      isDefault: f.isDefault,
      stages: stages
        .filter((s) => s.funnelId === f.id)
        .map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          kind: s.kind,
          sortOrder: s.sortOrder,
          probability: s.probability,
          requiresApprovalToEnter: s.requiresApprovalToEnter,
        })),
    }))
  })
}

/** Configurable industry picklist for the tenant. */
export async function listIndustries(): Promise<string[]> {
  const ctx = await requireContext()
  const [s] = await runInTenant(ctx.tenantId, (tx) =>
    tx
      .select({ industries: tenantSettings.industries })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
  )
  return s?.industries ?? []
}

export async function listTaxOptions(): Promise<
  { id: string; name: string; ratePercent: string; isDefault: boolean }[]
> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        id: taxSettings.id,
        name: taxSettings.name,
        ratePercent: taxSettings.ratePercent,
        isDefault: taxSettings.isDefault,
      })
      .from(taxSettings)
      .where(eq(taxSettings.isActive, true))
      .orderBy(asc(taxSettings.name))
  )
}
