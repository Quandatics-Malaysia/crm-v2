"use server"

import { and, ilike, isNull, or, sql } from "drizzle-orm"
import { requireContext } from "@/lib/server-context"
import { runInTenant } from "@/db"
import {
  leads,
  accounts,
  persons,
  funnels,
  quotations,
  projects,
} from "@/db/schema"
import { PERMISSIONS } from "@/lib/permissions"
import { visibleMemberIds, ownerScope } from "@/lib/access-scope"

export type SearchHitType =
  | "lead"
  | "account"
  | "contact"
  | "opportunity"
  | "quotation"
  | "project"

export type SearchHit = {
  id: string
  type: SearchHitType
  /** Group heading shown in the palette (matches the nav vocabulary). */
  group: string
  title: string
  subtitle?: string
  href: string
}

/** Records returned per entity type — keeps the palette tight and queries cheap. */
const PER_TYPE_LIMIT = 5

/**
 * Tenant-scoped global search backing the ⌘K command palette. Runs inside the
 * active tenant's RLS transaction and only searches the entity types the caller
 * is permitted to view, narrowed to their owner/managed-subtree scope (same
 * record-level access as the list pages). Returns nothing for queries under two
 * characters.
 */
export async function globalSearch(query: string): Promise<SearchHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const ctx = await requireContext()
  if (!ctx.tenantId) return []
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`

  return runInTenant(ctx.tenantId, async (tx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const hits: SearchHit[] = []

    if (ctx.can(PERMISSIONS.LEAD_VIEW)) {
      const rows = await tx
        .select({
          id: leads.id,
          name: leads.name,
          company: leads.companyName,
        })
        .from(leads)
        .where(
          and(
            isNull(leads.deletedAt),
            ownerScope(leads.ownerMemberId, visible),
            or(
              ilike(leads.name, like),
              ilike(leads.companyName, like),
              ilike(leads.email, like)
            )
          )
        )
        .limit(PER_TYPE_LIMIT)
      for (const r of rows)
        hits.push({
          id: r.id,
          type: "lead",
          group: "Leads",
          title: r.name,
          subtitle: r.company ?? undefined,
          href: `/leads/${r.id}`,
        })
    }

    if (ctx.can(PERMISSIONS.ACCOUNT_VIEW)) {
      const rows = await tx
        .select({ id: accounts.id, name: accounts.name, code: accounts.code })
        .from(accounts)
        .where(
          and(
            isNull(accounts.deletedAt),
            ownerScope(accounts.ownerMemberId, visible),
            or(ilike(accounts.name, like), ilike(accounts.code, like))
          )
        )
        .limit(PER_TYPE_LIMIT)
      for (const r of rows)
        hits.push({
          id: r.id,
          type: "account",
          group: "Accounts",
          title: r.name,
          subtitle: r.code ?? undefined,
          href: `/accounts/${r.id}`,
        })
    }

    if (ctx.can(PERMISSIONS.PERSON_VIEW)) {
      // Contacts inherit their owner from the parent account.
      const rows = await tx
        .select({
          id: persons.id,
          firstName: persons.firstName,
          lastName: persons.lastName,
          email: persons.email,
          accountName: accounts.name,
        })
        .from(persons)
        .innerJoin(accounts, sql`${persons.accountId} = ${accounts.id}`)
        .where(
          and(
            isNull(persons.deletedAt),
            ownerScope(accounts.ownerMemberId, visible),
            or(
              ilike(persons.firstName, like),
              ilike(persons.lastName, like),
              ilike(persons.email, like)
            )
          )
        )
        .limit(PER_TYPE_LIMIT)
      for (const r of rows) {
        const name = [r.firstName, r.lastName].filter(Boolean).join(" ")
        hits.push({
          id: r.id,
          type: "contact",
          group: "Contacts",
          title: name || r.email || "Contact",
          subtitle: r.accountName ?? undefined,
          href: `/persons/${r.id}`,
        })
      }
    }

    if (ctx.can(PERMISSIONS.OPPORTUNITY_VIEW)) {
      const rows = await tx
        .select({ id: funnels.id, name: funnels.name })
        .from(funnels)
        .where(
          and(
            isNull(funnels.deletedAt),
            ownerScope(funnels.ownerMemberId, visible),
            ilike(funnels.name, like)
          )
        )
        .limit(PER_TYPE_LIMIT)
      for (const r of rows)
        hits.push({
          id: r.id,
          type: "opportunity",
          group: "Funnel",
          title: r.name,
          href: `/funnel/${r.id}`,
        })
    }

    if (ctx.can(PERMISSIONS.QUOTATION_VIEW)) {
      // Quotations inherit their owner from the parent opportunity.
      const rows = await tx
        .select({
          id: quotations.id,
          quoteNumber: quotations.quoteNumber,
          oppName: funnels.name,
        })
        .from(quotations)
        .innerJoin(
          funnels,
          sql`${quotations.funnelId} = ${funnels.id}`
        )
        .where(
          and(
            isNull(quotations.deletedAt),
            ownerScope(funnels.ownerMemberId, visible),
            ilike(quotations.quoteNumber, like)
          )
        )
        .limit(PER_TYPE_LIMIT)
      for (const r of rows)
        hits.push({
          id: r.id,
          type: "quotation",
          group: "Quotations",
          title: r.quoteNumber,
          subtitle: r.oppName ?? undefined,
          href: `/quotations/${r.id}`,
        })
    }

    if (ctx.can(PERMISSIONS.PROJECT_VIEW)) {
      const rows = await tx
        .select({
          id: projects.id,
          name: projects.name,
          code: projects.projectCode,
        })
        .from(projects)
        .where(
          and(
            isNull(projects.deletedAt),
            ownerScope(projects.ownerMemberId, visible),
            or(ilike(projects.name, like), ilike(projects.projectCode, like))
          )
        )
        .limit(PER_TYPE_LIMIT)
      for (const r of rows)
        hits.push({
          id: r.id,
          type: "project",
          group: "Projects",
          title: r.name,
          subtitle: r.code ?? undefined,
          href: `/projects/${r.id}`,
        })
    }

    return hits
  })
}
