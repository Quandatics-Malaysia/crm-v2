import "server-only"
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { type Tx, type ServerContext } from "@/lib/actions"
import { getEntitledModuleMap } from "@/lib/modules.server"
import { PERMISSIONS, type PermissionKey } from "@/lib/permissions"
import {
  visibleMemberIds,
  ownerScope,
  ownsOrManages,
} from "@/lib/access-scope"
import {
  leads,
  accounts,
  persons,
  pipelines,
  pipelineStages,
  funnels,
  opportunities,
  opportunityProducts,
  quotations,
  quotationLineItems,
  projects,
  member,
  user,
  organization,
  funnelStageHistory,
  stageApprovalRequests,
  intercompanyDeals,
  intercompanyDealParties,
  intercompanyDealResponses,
} from "@/db/schema"

/**
 * Shared read layer for the six list/detail CRM resources. Each `<entity>List`
 * / `<entity>Get` pair is the exact Drizzle query body that used to live inline
 * inside the corresponding UI server action's `withTenant(...)` callback — moved
 * here so the server action AND (later) the REST API route handler call the
 * SAME implementation. Behavior-preserving: callers control paging via
 * `{ limit, offset }`; the UI actions pass their historical defaults (see each
 * actions.ts) so their return shape/values are unchanged.
 */

export type PagingOpts = { limit: number; offset: number }
export type ReadResult<T> = { rows: T[]; total: number }

const countOf = (rows: { count: number }[]): number => rows[0]?.count ?? 0

// ---------------------------------------------------------------------------
// leads (apps/web/app/(app)/leads/actions.ts)
// ---------------------------------------------------------------------------

export type LeadRow = typeof leads.$inferSelect

export async function leadsList(
  tx: Tx,
  ctx: ServerContext,
  { limit, offset }: PagingOpts
): Promise<ReadResult<LeadRow>> {
  const visible = await visibleMemberIds(tx, ctx)
  const where = and(isNull(leads.deletedAt), ownerScope(leads.ownerMemberId, visible))
  const [rows, totalRows] = await Promise.all([
    tx
      .select()
      .from(leads)
      .where(where)
      .orderBy(desc(leads.createdAt))
      .limit(limit)
      .offset(offset),
    tx.select({ count: sql<number>`count(*)::int` }).from(leads).where(where),
  ])
  return { rows, total: countOf(totalRows) }
}

export type LeadDetail = {
  lead: LeadRow
  stageName: string | null
  funnelName: string | null
  accountName: string | null
  personName: string | null
}

export async function leadsGet(
  tx: Tx,
  ctx: ServerContext,
  id: string
): Promise<LeadDetail | null> {
  const visible = await visibleMemberIds(tx, ctx)
  const [lead] = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
    .limit(1)
  if (!lead) return null
  if (!ownsOrManages(visible, lead.ownerMemberId)) return null

  let stageName: string | null = null
  if (lead.currentStageId) {
    const [stage] = await tx
      .select({ name: pipelineStages.name })
      .from(pipelineStages)
      .where(eq(pipelineStages.id, lead.currentStageId))
      .limit(1)
    stageName = stage?.name ?? null
  }

  let funnelName: string | null = null
  if (lead.pipelineId) {
    const [funnel] = await tx
      .select({ name: pipelines.name })
      .from(pipelines)
      .where(eq(pipelines.id, lead.pipelineId))
      .limit(1)
    funnelName = funnel?.name ?? null
  }

  let accountName: string | null = null
  if (lead.convertedAccountId) {
    const [acct] = await tx
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, lead.convertedAccountId))
      .limit(1)
    accountName = acct?.name ?? null
  }

  let personName: string | null = null
  if (lead.convertedPersonId) {
    const [p] = await tx
      .select({ firstName: persons.firstName, lastName: persons.lastName })
      .from(persons)
      .where(eq(persons.id, lead.convertedPersonId))
      .limit(1)
    if (p) personName = [p.firstName, p.lastName].filter(Boolean).join(" ")
  }

  return { lead, stageName, funnelName, accountName, personName }
}

// ---------------------------------------------------------------------------
// accounts (apps/web/app/(app)/accounts/actions.ts)
// ---------------------------------------------------------------------------

export type AccountRow = typeof accounts.$inferSelect

export type AccountListItem = AccountRow & {
  parentAccountName: string | null
  ownerName: string | null
}

export async function accountsList(
  tx: Tx,
  ctx: ServerContext,
  { limit, offset }: PagingOpts
): Promise<ReadResult<AccountListItem>> {
  const visible = await visibleMemberIds(tx, ctx)
  const where = and(isNull(accounts.deletedAt), ownerScope(accounts.ownerMemberId, visible))
  const [rows, totalRows] = await Promise.all([
    tx
      .select({ account: accounts, ownerName: user.name })
      .from(accounts)
      .leftJoin(member, eq(accounts.ownerMemberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .where(where)
      .orderBy(asc(accounts.name))
      .limit(limit)
      .offset(offset),
    tx.select({ count: sql<number>`count(*)::int` }).from(accounts).where(where),
  ])

  // Parent name is resolved from the same page of results (matches the
  // original listAccounts behavior — not a full-table lookup).
  const byId = new Map(rows.map((r) => [r.account.id, r.account]))
  const mapped: AccountListItem[] = rows.map((r) => ({
    ...r.account,
    parentAccountName: r.account.parentAccountId
      ? (byId.get(r.account.parentAccountId)?.name ?? null)
      : null,
    ownerName: r.ownerName ?? null,
  }))
  return { rows: mapped, total: countOf(totalRows) }
}

export type AccountFunnelItem = {
  funnelId: string
  name: string
  status: string
  amount: string | null
  currency: string
  pipelineId: string
  stageId: string
  stageName: string
  stageCode: string
  stageKind: string
}

export type AccountDetail = {
  account: AccountRow
  parent: AccountRow | null
  endUserAccount: { id: string; name: string } | null
  children: AccountRow[]
  contacts: (typeof persons.$inferSelect)[]
  pipelines: AccountFunnelItem[]
  ownerName: string | null
}

export async function accountsGet(
  tx: Tx,
  ctx: ServerContext,
  id: string
): Promise<AccountDetail | null> {
  const visible = await visibleMemberIds(tx, ctx)
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
    .limit(1)
  if (!account) return null
  if (!ownsOrManages(visible, account.ownerMemberId)) return null

  const parent = account.parentAccountId
    ? ((
        await tx
          .select()
          .from(accounts)
          .where(
            and(eq(accounts.id, account.parentAccountId), isNull(accounts.deletedAt))
          )
          .limit(1)
      )[0] ?? null)
    : null

  // For resellers, resolve the linked end-user client account (name + id).
  const endUserAccount = account.endUserAccountId
    ? ((
        await tx
          .select({ id: accounts.id, name: accounts.name })
          .from(accounts)
          .where(
            and(eq(accounts.id, account.endUserAccountId), isNull(accounts.deletedAt))
          )
          .limit(1)
      )[0] ?? null)
    : null

  const children = await tx
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.parentAccountId, id),
        isNull(accounts.deletedAt),
        ownerScope(accounts.ownerMemberId, visible)
      )
    )
    .orderBy(asc(accounts.name))

  const contacts = await tx
    .select()
    .from(persons)
    .where(and(eq(persons.accountId, id), isNull(persons.deletedAt)))
    .orderBy(asc(persons.firstName))

  const pipelinesForAccount = await tx
    .select({
      funnelId: funnels.id,
      name: funnels.name,
      status: funnels.status,
      amount: funnels.estimatedAmount,
      currency: funnels.currency,
      pipelineId: funnels.pipelineId,
      stageId: pipelineStages.id,
      stageName: pipelineStages.name,
      stageCode: pipelineStages.code,
      stageKind: pipelineStages.kind,
    })
    .from(funnels)
    .innerJoin(pipelineStages, eq(funnels.currentStageId, pipelineStages.id))
    .where(
      and(
        eq(funnels.accountId, id),
        isNull(funnels.deletedAt),
        ownerScope(funnels.ownerMemberId, visible)
      )
    )
    .orderBy(asc(pipelineStages.sortOrder), asc(funnels.name))

  // Resolve the account owner / account manager (member -> user name).
  const ownerName = account.ownerMemberId
    ? ((
        await tx
          .select({ name: user.name })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .where(eq(member.id, account.ownerMemberId))
          .limit(1)
      )[0]?.name ?? null)
    : null

  return {
    account,
    parent,
    endUserAccount,
    children,
    contacts,
    pipelines: pipelinesForAccount as AccountFunnelItem[],
    ownerName,
  }
}

// ---------------------------------------------------------------------------
// persons (apps/web/app/(app)/persons/actions.ts)
// ---------------------------------------------------------------------------

export type PersonRow = typeof persons.$inferSelect
export type PersonListItem = PersonRow & { accountName: string | null }

export async function personsList(
  tx: Tx,
  ctx: ServerContext,
  { limit, offset }: PagingOpts
): Promise<ReadResult<PersonListItem>> {
  const visible = await visibleMemberIds(tx, ctx)
  const where = and(
    isNull(persons.deletedAt),
    isNull(accounts.deletedAt),
    ownerScope(accounts.ownerMemberId, visible)
  )
  const [rows, totalRows] = await Promise.all([
    tx
      .select({ person: persons, accountName: accounts.name })
      .from(persons)
      .innerJoin(accounts, eq(persons.accountId, accounts.id))
      .where(where)
      .orderBy(asc(persons.firstName), asc(persons.lastName))
      .limit(limit)
      .offset(offset),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(persons)
      .innerJoin(accounts, eq(persons.accountId, accounts.id))
      .where(where),
  ])
  return {
    rows: rows.map((r) => ({ ...r.person, accountName: r.accountName })),
    total: countOf(totalRows),
  }
}

export type PersonOpportunity = {
  id: string
  name: string
  amount: string | null
  currency: string
  status: string
  stageName: string | null
  stageKind: string | null
  stageProbability: string | null
}

export type PersonProject = {
  id: string
  name: string
  projectCode: string | null
  status: string
}

export type PersonDetail = {
  person: PersonRow
  accountName: string | null
  funnels: PersonOpportunity[]
  projects: PersonProject[]
}

export async function personsGet(
  tx: Tx,
  ctx: ServerContext,
  id: string
): Promise<PersonDetail | null> {
  const projectsEnabled = (await getEntitledModuleMap()).projects
  const visible = await visibleMemberIds(tx, ctx)
  const [row] = await tx
    .select({
      person: persons,
      accountName: accounts.name,
      accountOwner: accounts.ownerMemberId,
    })
    .from(persons)
    .innerJoin(accounts, eq(persons.accountId, accounts.id))
    .where(
      and(eq(persons.id, id), isNull(persons.deletedAt), isNull(accounts.deletedAt))
    )
    .limit(1)
  if (!row) return null
  if (!ownsOrManages(visible, row.accountOwner)) return null

  const opps = await tx
    .select({
      id: funnels.id,
      name: funnels.name,
      amount: funnels.estimatedAmount,
      currency: funnels.currency,
      status: funnels.status,
      stageName: pipelineStages.name,
      stageKind: pipelineStages.kind,
      stageProbability: pipelineStages.probability,
    })
    .from(funnels)
    .leftJoin(pipelineStages, eq(funnels.currentStageId, pipelineStages.id))
    .where(and(eq(funnels.primaryPersonId, id), isNull(funnels.deletedAt)))
    .orderBy(desc(funnels.updatedAt))

  // Projects that belong to this contact's pipelines (the deals they're on).
  const oppIds = opps.map((o) => o.id)
  const projs = projectsEnabled && oppIds.length
    ? await tx
        .select({
          id: projects.id,
          name: projects.name,
          projectCode: projects.projectCode,
          status: projects.status,
        })
        .from(projects)
        .where(and(inArray(projects.funnelId, oppIds), isNull(projects.deletedAt)))
        .orderBy(desc(projects.updatedAt))
    : []

  return {
    person: row.person,
    accountName: row.accountName,
    funnels: opps,
    projects: projs,
  }
}

// ---------------------------------------------------------------------------
// opportunities — Opportunity containers (apps/web/app/(app)/opportunities/actions.ts)
// ---------------------------------------------------------------------------

export type ContactRef = { id: string; name: string; designation: string | null }

export type OpportunityContainerRow = {
  id: string
  code: string
  name: string
  accountId: string
  accountName: string
  ownerName: string | null
  totalEstimatedFunnelAmount: string | null
  funnelCount: number
  currency: string
  createdAt: Date
}

export async function opportunitiesList(
  tx: Tx,
  ctx: ServerContext,
  { limit, offset }: PagingOpts
): Promise<ReadResult<OpportunityContainerRow>> {
  const visible = await visibleMemberIds(tx, ctx)
  const where = and(
    isNull(opportunities.deletedAt),
    ownerScope(opportunities.ownerMemberId, visible)
  )
  const [rows, totalRows] = await Promise.all([
    tx
      .select({
        id: opportunities.id,
        code: opportunities.code,
        name: opportunities.name,
        accountId: opportunities.accountId,
        accountName: accounts.name,
        ownerName: user.name,
        totalEstimatedFunnelAmount: opportunities.totalEstimatedFunnelAmount,
        currency: opportunities.currency,
        createdAt: opportunities.createdAt,
      })
      .from(opportunities)
      .innerJoin(accounts, eq(opportunities.accountId, accounts.id))
      .leftJoin(member, eq(opportunities.ownerMemberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .where(where)
      .orderBy(desc(opportunities.createdAt))
      .limit(limit)
      .offset(offset),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(opportunities)
      .innerJoin(accounts, eq(opportunities.accountId, accounts.id))
      .where(where),
  ])

  if (rows.length === 0) return { rows: [], total: countOf(totalRows) }
  const counts = await tx
    .select({
      opportunityId: funnels.opportunityId,
      n: sql<number>`count(*)::int`,
    })
    .from(funnels)
    .where(
      and(isNull(funnels.deletedAt), inArray(funnels.opportunityId, rows.map((r) => r.id)))
    )
    .groupBy(funnels.opportunityId)
  const countBy = new Map(counts.map((c) => [c.opportunityId, c.n]))
  return {
    rows: rows.map((r) => ({ ...r, funnelCount: countBy.get(r.id) ?? 0 })),
    total: countOf(totalRows),
  }
}

export type OpportunityContainerDetail = {
  opportunity: typeof opportunities.$inferSelect
  accountId: string
  accountName: string
  ownerName: string | null
  ownerContact: ContactRef | null
  powerSponsorContact: ContactRef | null
  funnels: {
    id: string
    name: string
    stageName: string | null
    stageKind: string | null
    status: string
    estimatedAmount: string | null
    currency: string
  }[]
  quotations: {
    id: string
    quoteNumber: string
    status: string
    total: string | null
    currency: string
    funnelId: string
    funnelName: string
  }[]
  products: {
    id: string
    description: string | null
    quantity: string
    unitPrice: string
    productCategory: string | null
    funnelId: string
    funnelName: string
  }[]
}

export async function opportunitiesGet(
  tx: Tx,
  ctx: ServerContext,
  id: string
): Promise<OpportunityContainerDetail | null> {
  const visible = await visibleMemberIds(tx, ctx)
  const [opp] = await tx
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
    .limit(1)
  if (!opp) return null
  if (!ownsOrManages(visible, opp.ownerMemberId)) return null

  const [acct] = await tx
    .select({ name: accounts.name })
    .from(accounts)
    .where(eq(accounts.id, opp.accountId))
    .limit(1)
  const [owner] = await tx
    .select({ name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.id, opp.ownerMemberId))
    .limit(1)

  // Owner/Power Sponsor Contact — resolved with "Designation" (a Salesforce
  // formula field derived live from persons.title, never stored).
  async function resolveContact(personId: string | null): Promise<ContactRef | null> {
    if (!personId) return null
    const [p] = await tx
      .select({
        firstName: persons.firstName,
        lastName: persons.lastName,
        title: persons.title,
      })
      .from(persons)
      .where(eq(persons.id, personId))
      .limit(1)
    if (!p) return null
    return {
      id: personId,
      name: [p.firstName, p.lastName].filter(Boolean).join(" "),
      designation: p.title,
    }
  }
  const [ownerContact, powerSponsorContact] = await Promise.all([
    resolveContact(opp.ownerContactId),
    resolveContact(opp.powerSponsorContactId),
  ])

  const children = await tx
    .select({
      id: funnels.id,
      name: funnels.name,
      status: funnels.status,
      estimatedAmount: funnels.estimatedAmount,
      currency: funnels.currency,
      stageName: pipelineStages.name,
      stageKind: pipelineStages.kind,
    })
    .from(funnels)
    .leftJoin(pipelineStages, eq(funnels.currentStageId, pipelineStages.id))
    .where(and(eq(funnels.opportunityId, id), isNull(funnels.deletedAt)))
    .orderBy(desc(funnels.createdAt))

  const funnelIds = children.map((c) => c.id)
  const funnelName = new Map(children.map((c) => [c.id, c.name]))

  // Quotations + products roll up from ALL funnels under this opportunity.
  const quotes = funnelIds.length
    ? await tx
        .select({
          id: quotations.id,
          quoteNumber: quotations.quoteNumber,
          status: quotations.status,
          total: quotations.total,
          currency: quotations.currency,
          funnelId: quotations.funnelId,
        })
        .from(quotations)
        .where(and(inArray(quotations.funnelId, funnelIds), isNull(quotations.deletedAt)))
        .orderBy(desc(quotations.createdAt))
    : []

  const prods = funnelIds.length
    ? await tx
        .select({
          id: opportunityProducts.id,
          description: opportunityProducts.description,
          quantity: opportunityProducts.quantity,
          unitPrice: opportunityProducts.unitPrice,
          productCategory: opportunityProducts.productCategory,
          funnelId: opportunityProducts.funnelId,
        })
        .from(opportunityProducts)
        .where(inArray(opportunityProducts.funnelId, funnelIds))
        .orderBy(desc(opportunityProducts.createdAt))
    : []

  return {
    opportunity: opp,
    accountId: opp.accountId,
    accountName: acct?.name ?? "—",
    ownerName: owner?.name ?? null,
    ownerContact,
    powerSponsorContact,
    funnels: children,
    quotations: quotes.map((q) => ({
      ...q,
      funnelName: funnelName.get(q.funnelId) ?? "—",
    })),
    products: prods.map((p) => ({
      ...p,
      funnelName: funnelName.get(p.funnelId) ?? "—",
    })),
  }
}

// ---------------------------------------------------------------------------
// funnels — funnel/staged-deal rows (apps/web/app/(app)/funnel/actions.ts)
// ---------------------------------------------------------------------------

export type PartyInput = {
  partnerEntityId: string
  shareType: "percent" | "amount"
  shareValue: string
  currency?: string | null
  manualFxRate?: string | null
}

export type PartyRow = PartyInput & { partnerName: string }

/**
 * Live-resolved party rows for a set of funnels, grouped by funnelId. Entity
 * names resolve LIVE (`organization` is deliberately RLS-excluded, so this
 * sibling-entity join is allowed) so a rename in Settings propagates to every
 * deal that references it. Shared with funnel/actions.ts's mutation actions
 * (createOpportunity/updateOpportunity), which import it from here.
 */
export async function loadPartiesByOpportunity(
  tx: Tx,
  opportunityIds: string[]
): Promise<Map<string, PartyRow[]>> {
  const byOpp = new Map<string, PartyRow[]>()
  if (opportunityIds.length === 0) return byOpp
  const rows = await tx
    .select({
      funnelId: intercompanyDealParties.funnelId,
      partnerEntityId: intercompanyDealParties.partnerEntityId,
      partnerName: organization.name,
      shareType: intercompanyDealParties.shareType,
      shareValue: intercompanyDealParties.shareValue,
      currency: intercompanyDealParties.currency,
      manualFxRate: intercompanyDealParties.manualFxRate,
    })
    .from(intercompanyDealParties)
    .innerJoin(organization, eq(intercompanyDealParties.partnerEntityId, organization.id))
    .where(inArray(intercompanyDealParties.funnelId, opportunityIds))
    .orderBy(asc(intercompanyDealParties.sortOrder))
  for (const r of rows) {
    const list = byOpp.get(r.funnelId) ?? []
    list.push({
      partnerEntityId: r.partnerEntityId,
      partnerName: r.partnerName,
      shareType: r.shareType,
      shareValue: r.shareValue,
      currency: r.currency,
      manualFxRate: r.manualFxRate,
    })
    byOpp.set(r.funnelId, list)
  }
  return byOpp
}

export type OpportunityListRow = {
  id: string
  name: string
  accountId: string
  accountName: string
  amount: string | null
  estimatedAmount: string | null
  recognizedPercent: string | null
  description: string | null
  projectYear: number | null
  isIntercompany: boolean
  parties: PartyRow[]
  currency: string
  status: string
  expectedCloseDate: string | null
  ownerMemberId: string
  ownerName: string | null
  stageId: string
  stageName: string
  stageKind: string
  stageProbability: string
  stageSortOrder: number
  pipelineId: string
  pipelineIsDefault: boolean
  primaryQuotationId: string | null
  projectNatureCode: string | null
  projectNatures: string[] | null
  customFields: Record<string, string> | null
}

export async function funnelsList(
  tx: Tx,
  ctx: ServerContext,
  { limit, offset }: PagingOpts
): Promise<ReadResult<OpportunityListRow>> {
  const financeEnabled = (await getEntitledModuleMap()).finance
  const visible = await visibleMemberIds(tx, ctx)
  const where = and(isNull(funnels.deletedAt), ownerScope(funnels.ownerMemberId, visible))
  const [rows, totalRows] = await Promise.all([
    tx
      .select({
        id: funnels.id,
        name: funnels.name,
        accountId: funnels.accountId,
        accountName: accounts.name,
        amount: funnels.amount,
        estimatedAmount: funnels.estimatedAmount,
        recognizedPercent: funnels.recognizedPercent,
        description: funnels.description,
        projectYear: funnels.projectYear,
        isIntercompany: funnels.isIntercompany,
        currency: funnels.currency,
        status: funnels.status,
        expectedCloseDate: funnels.expectedCloseDate,
        ownerMemberId: funnels.ownerMemberId,
        ownerName: user.name,
        stageId: pipelineStages.id,
        stageName: pipelineStages.name,
        stageKind: pipelineStages.kind,
        stageProbability: pipelineStages.probability,
        stageSortOrder: pipelineStages.sortOrder,
        pipelineId: funnels.pipelineId,
        pipelineIsDefault: pipelines.isDefault,
        primaryQuotationId: funnels.primaryQuotationId,
        projectNatureCode: funnels.projectNatureCode,
        projectNatures: funnels.projectNatures,
        customFields: funnels.customFields,
      })
      .from(funnels)
      .innerJoin(accounts, eq(funnels.accountId, accounts.id))
      .innerJoin(pipelineStages, eq(funnels.currentStageId, pipelineStages.id))
      .innerJoin(pipelines, eq(funnels.pipelineId, pipelines.id))
      .leftJoin(member, eq(funnels.ownerMemberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .where(where)
      .orderBy(desc(funnels.createdAt))
      .limit(limit)
      .offset(offset),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(funnels)
      .innerJoin(accounts, eq(funnels.accountId, accounts.id))
      .innerJoin(pipelineStages, eq(funnels.currentStageId, pipelineStages.id))
      .innerJoin(pipelines, eq(funnels.pipelineId, pipelines.id))
      .where(where),
  ])

  const partiesByOpp = financeEnabled
    ? await loadPartiesByOpportunity(
        tx,
        rows.map((r) => r.id)
      )
    : new Map<string, PartyRow[]>()
  return {
    rows: rows.map((r) => ({ ...r, parties: partiesByOpp.get(r.id) ?? [] })),
    total: countOf(totalRows),
  }
}

export type OpportunityDetail = {
  parties: PartyRow[]
  partnerResponses: {
    partnerEntityId: string
    response: "accepted" | "declined"
    reason: string | null
    respondedAt: Date
  }[]
  opportunity: typeof funnels.$inferSelect
  accountName: string
  accountCurrency: string
  container: typeof opportunities.$inferSelect | null
  personName: string | null
  ownerName: string | null
  stage: typeof pipelineStages.$inferSelect
  funnelStagesList: (typeof pipelineStages.$inferSelect)[]
  quoteNumber: string | null
  amountFromQuote: boolean
  pendingApproval: { id: string; targetStageName: string } | null
  quotations: {
    id: string
    quoteNumber: string
    status: string
    total: string
    currency: string
    isPrimary: boolean
  }[]
  history: {
    id: string
    fromStageName: string | null
    toStageName: string
    source: string
    probabilityAtChange: string | null
    valueAtChange: string | null
    changedAt: Date
    changedByName: string | null
  }[]
}

export async function funnelsGet(
  tx: Tx,
  ctx: ServerContext,
  id: string
): Promise<OpportunityDetail | null> {
  const financeEnabled = (await getEntitledModuleMap()).finance
  const visible = await visibleMemberIds(tx, ctx)
  const [opp] = await tx
    .select()
    .from(funnels)
    .where(and(eq(funnels.id, id), isNull(funnels.deletedAt)))
    .limit(1)
  if (!opp) return null
  if (!ownsOrManages(visible, opp.ownerMemberId)) return null

  const [acct] = await tx
    .select({ name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(eq(accounts.id, opp.accountId))
    .limit(1)

  // Parent Opportunity container (Salesforce-style — funnel belongs to one).
  const [container] = await tx
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, opp.opportunityId))
    .limit(1)

  // The handling partners, live-resolved (see loadPartiesByOpportunity).
  const parties = financeEnabled
    ? (await loadPartiesByOpportunity(tx, [id])).get(id) ?? []
    : []

  // Each party's accept/decline on their slice of the assignment (written by
  // the partner tenant; readable here via the origin-side RLS policy on
  // responses). One intercompanyDeals mirror row per party.
  let partnerResponses: OpportunityDetail["partnerResponses"] = []
  if (financeEnabled && opp.isIntercompany) {
    const rows = await tx
      .select({
        partnerEntityId: intercompanyDeals.partnerTenantId,
        response: intercompanyDealResponses.response,
        reason: intercompanyDealResponses.reason,
        respondedAt: intercompanyDealResponses.respondedAt,
      })
      .from(intercompanyDeals)
      .innerJoin(
        intercompanyDealResponses,
        eq(intercompanyDealResponses.dealId, intercompanyDeals.id)
      )
      .where(eq(intercompanyDeals.funnelId, id))
    partnerResponses = rows
  }

  let personName: string | null = null
  if (opp.primaryPersonId) {
    const [p] = await tx
      .select({ firstName: persons.firstName, lastName: persons.lastName })
      .from(persons)
      .where(eq(persons.id, opp.primaryPersonId))
      .limit(1)
    if (p) personName = [p.firstName, p.lastName].filter(Boolean).join(" ")
  }

  const [owner] = await tx
    .select({ name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.id, opp.ownerMemberId))
    .limit(1)

  const [stage] = await tx
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.id, opp.currentStageId))
    .limit(1)

  // Resolve the primary quotation's number so the summary can show that the
  // net deal value derives "from quotation <quoteNumber>".
  let quoteNumber: string | null = null
  if (opp.primaryQuotationId) {
    const [pq] = await tx
      .select({ quoteNumber: quotations.quoteNumber })
      .from(quotations)
      .where(eq(quotations.id, opp.primaryQuotationId))
      .limit(1)
    quoteNumber = pq?.quoteNumber ?? null
  }
  const amountFromQuote = quoteNumber !== null

  const funnelStagesList = await tx
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, opp.pipelineId))
    .orderBy(asc(pipelineStages.sortOrder))

  const quotes = await tx
    .select({
      id: quotations.id,
      quoteNumber: quotations.quoteNumber,
      status: quotations.status,
      total: quotations.total,
      currency: quotations.currency,
      isPrimary: quotations.isPrimary,
    })
    .from(quotations)
    .where(and(eq(quotations.funnelId, id), isNull(quotations.deletedAt)))
    .orderBy(desc(quotations.version))

  const toStage = alias(pipelineStages, "to_stage")
  const historyRows = await tx
    .select({
      id: funnelStageHistory.id,
      toStageName: toStage.name,
      source: funnelStageHistory.source,
      probabilityAtChange: funnelStageHistory.probabilityAtChange,
      valueAtChange: funnelStageHistory.valueAtChange,
      changedAt: funnelStageHistory.changedAt,
      fromStageId: funnelStageHistory.fromStageId,
      changedByName: user.name,
    })
    .from(funnelStageHistory)
    .innerJoin(toStage, eq(funnelStageHistory.toStageId, toStage.id))
    .leftJoin(member, eq(funnelStageHistory.changedByMemberId, member.id))
    .leftJoin(user, eq(member.userId, user.id))
    .where(eq(funnelStageHistory.funnelId, id))
    .orderBy(desc(funnelStageHistory.changedAt))

  // Resolve fromStage names with a single lookup map.
  const stageNameById = new Map(funnelStagesList.map((s) => [s.id, s.name]))

  // A pending approval freezes the funnel CTA on the detail page so the
  // requester sees the in-flight state instead of a still-active Advance.
  const [pending] = await tx
    .select({
      id: stageApprovalRequests.id,
      targetStageId: stageApprovalRequests.targetStageId,
    })
    .from(stageApprovalRequests)
    .where(
      and(
        eq(stageApprovalRequests.funnelId, id),
        eq(stageApprovalRequests.status, "pending")
      )
    )
    .limit(1)
  const pendingApproval = pending
    ? {
        id: pending.id,
        targetStageName: stageNameById.get(pending.targetStageId) ?? "—",
      }
    : null

  const history = historyRows.map((h) => ({
    id: h.id,
    fromStageName: h.fromStageId ? (stageNameById.get(h.fromStageId) ?? null) : null,
    toStageName: h.toStageName,
    source: h.source,
    probabilityAtChange: h.probabilityAtChange,
    valueAtChange: h.valueAtChange,
    changedAt: h.changedAt,
    changedByName: h.changedByName,
  }))

  return {
    opportunity: opp,
    accountName: acct?.name ?? "—",
    accountCurrency: acct?.currency ?? "MYR",
    container: container ?? null,
    parties,
    partnerResponses,
    personName,
    ownerName: owner?.name ?? null,
    stage,
    funnelStagesList,
    quoteNumber,
    amountFromQuote,
    pendingApproval,
    quotations: quotes,
    history,
  }
}

// ---------------------------------------------------------------------------
// quotations (apps/web/app/(app)/quotations/actions.ts)
// ---------------------------------------------------------------------------

export type QuotationRow = typeof quotations.$inferSelect
export type QuotationLineRow = typeof quotationLineItems.$inferSelect

export type QuotationListItem = QuotationRow & {
  opportunityName: string | null
  lineItemCount: number
}

export async function quotationsList(
  tx: Tx,
  ctx: ServerContext,
  { limit, offset }: PagingOpts
): Promise<ReadResult<QuotationListItem>> {
  const visible = await visibleMemberIds(tx, ctx)
  const where = and(
    isNull(quotations.deletedAt),
    ownerScope(funnels.ownerMemberId, visible)
  )
  const [rows, totalRows] = await Promise.all([
    tx
      .select({
        q: quotations,
        opportunityName: funnels.name,
        lineItemCount: sql<number>`(
          select count(*) from ${quotationLineItems}
          where ${quotationLineItems.quotationId} = ${quotations.id}
        )`.mapWith(Number),
      })
      .from(quotations)
      .leftJoin(funnels, eq(quotations.funnelId, funnels.id))
      .where(where)
      .orderBy(desc(quotations.createdAt))
      .limit(limit)
      .offset(offset),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(quotations)
      .leftJoin(funnels, eq(quotations.funnelId, funnels.id))
      .where(where),
  ])
  return {
    rows: rows.map((r) => ({
      ...r.q,
      opportunityName: r.opportunityName,
      lineItemCount: r.lineItemCount,
    })),
    total: countOf(totalRows),
  }
}

export type QuotationDetail = {
  quotation: QuotationRow
  lines: QuotationLineRow[]
  opportunityName: string | null
  container: { id: string; name: string } | null
  accountId: string | null
  accountName: string | null
}

export async function quotationsGet(
  tx: Tx,
  ctx: ServerContext,
  id: string
): Promise<QuotationDetail | null> {
  const visible = await visibleMemberIds(tx, ctx)
  const [row] = await tx
    .select({
      q: quotations,
      opportunityName: funnels.name,
      oppOwner: funnels.ownerMemberId,
      accountId: funnels.accountId,
      accountName: accounts.name,
      containerId: opportunities.id,
      containerName: opportunities.name,
    })
    .from(quotations)
    .leftJoin(funnels, eq(quotations.funnelId, funnels.id))
    .leftJoin(accounts, eq(funnels.accountId, accounts.id))
    .leftJoin(opportunities, eq(funnels.opportunityId, opportunities.id))
    .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
    .limit(1)
  if (!row) return null
  if (!ownsOrManages(visible, row.oppOwner)) return null
  const lines = await tx
    .select()
    .from(quotationLineItems)
    .where(eq(quotationLineItems.quotationId, id))
    .orderBy(asc(quotationLineItems.sortOrder))
  return {
    quotation: row.q,
    lines,
    opportunityName: row.opportunityName,
    container:
      row.containerId && row.containerName
        ? { id: row.containerId, name: row.containerName }
        : null,
    accountId: row.accountId ?? null,
    accountName: row.accountName ?? null,
  }
}

// ---------------------------------------------------------------------------
// Resource registry — consumed by the UI server actions above AND (Task 4)
// the REST API v1 route handlers, so both paths share one implementation.
// ---------------------------------------------------------------------------

export type ApiResource = {
  permission: PermissionKey
  /** Signed runtime entitlement owner. Omit for core resources. */
  module?: import("@/lib/module-registry").ModuleId
  list(tx: Tx, ctx: ServerContext, opts: PagingOpts): Promise<{ rows: unknown[]; total: number }>
  get(tx: Tx, ctx: ServerContext, id: string): Promise<unknown | null>
}

export const API_RESOURCES: Record<string, ApiResource> = {
  leads: { permission: PERMISSIONS.LEAD_VIEW, list: leadsList, get: leadsGet },
  accounts: { permission: PERMISSIONS.ACCOUNT_VIEW, list: accountsList, get: accountsGet },
  persons: { permission: PERMISSIONS.PERSON_VIEW, list: personsList, get: personsGet },
  opportunities: {
    permission: PERMISSIONS.OPPORTUNITY_VIEW,
    list: opportunitiesList,
    get: opportunitiesGet,
  },
  funnels: { permission: PERMISSIONS.OPPORTUNITY_VIEW, list: funnelsList, get: funnelsGet },
  quotations: {
    permission: PERMISSIONS.QUOTATION_VIEW,
    list: quotationsList,
    get: quotationsGet,
  },
}
