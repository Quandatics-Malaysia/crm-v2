"use server"

import { randomUUID } from "node:crypto"
import { and, desc, eq, ne, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { runInTenant, type Tx } from "@/db"
import {
  member,
  membershipProfiles,
  organization,
  platformSubscriptionInvoices,
  tenantSettings,
  user,
} from "@/db/schema"
import { runAction, type ActionResult } from "@/lib/action-result"
import { requireContext } from "@/lib/actions"
import { writeAudit } from "@/server/audit"

export type SubscriptionInvoiceView = {
  id: string
  invoiceNumber: string
  status: "draft" | "issued" | "paid" | "void"
  plan: string
  currency: string
  seats: number
  seatPrice: number
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  startsAt: string
  endsAt: string
  issuedAt: string | null
  dueAt: string | null
  notes: string | null
}

export type SubscriptionAdminView = {
  tenantId: string
  tenantName: string
  plan: string
  status: "active" | "trial" | "paused" | "expired" | "cancelled"
  seatLimit: number | null
  activeMemberCount: number
  startsAt: string
  endsAt: string
  defaultCurrency: string
  invoices: SubscriptionInvoiceView[]
}

export type IssueSeatLicenceInput = {
  plan: string
  seats: number
  startsAt: string
  endsAt: string
  seatPrice: number
  taxRate: number
  dueAt?: string
  notes?: string
}

function requirePlatformMaster<T extends { isSuperadmin: boolean; tenantId: string }>(ctx: T): T {
  if (!ctx.isSuperadmin) throw new Error("Only the platform master can issue tenant seats.")
  if (!ctx.tenantId) throw new Error("Select an organization before issuing seats.")
  return ctx
}

function parseDate(value: string, field: string, endOfDay = false): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be a valid date.`)
  const date = new Date(`${value}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}`)
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date.`)
  return date
}

function dateOnly(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : ""
}

function money(value: number): number {
  return Math.round(value * 100) / 100
}

function toInvoiceView(row: typeof platformSubscriptionInvoices.$inferSelect): SubscriptionInvoiceView {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    status: row.status,
    plan: row.plan,
    currency: row.currency,
    seats: row.additionalSeats,
    seatPrice: Number(row.seatPriceFullTerm),
    subtotal: Number(row.subtotal),
    taxRate: Number(row.taxRate),
    taxAmount: Number(row.taxAmount),
    total: Number(row.total),
    startsAt: dateOnly(row.subscriptionStartsAt),
    endsAt: dateOnly(row.subscriptionEndsAt),
    issuedAt: row.issuedAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    notes: row.notes,
  }
}

async function loadView(tx: Tx, tenantId: string): Promise<SubscriptionAdminView> {
  const [settings] = await tx
    .select({
      plan: tenantSettings.subscriptionPlan,
      status: tenantSettings.subscriptionStatus,
      seatLimit: tenantSettings.subscriptionSeatLimit,
      startsAt: tenantSettings.subscriptionStartsAt,
      endsAt: tenantSettings.subscriptionEndsAt,
      currency: tenantSettings.defaultCurrency,
      tenantName: organization.name,
    })
    .from(tenantSettings)
    .innerJoin(organization, eq(organization.id, tenantSettings.organizationId))
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1)
  if (!settings) throw new Error("Tenant settings were not found.")

  // Platform masters can enter a tenant to administer it, but never consume a
  // customer seat.
  const [usage] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(membershipProfiles)
    .innerJoin(member, eq(member.id, membershipProfiles.memberId))
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(membershipProfiles.tenantId, tenantId),
        eq(membershipProfiles.status, "active"),
        ne(user.isSuperadmin, true)
      )
    )
  const invoices = await tx
    .select()
    .from(platformSubscriptionInvoices)
    .where(eq(platformSubscriptionInvoices.tenantId, tenantId))
    .orderBy(desc(platformSubscriptionInvoices.createdAt))
    .limit(100)

  const allowedStatuses = ["active", "trial", "paused", "expired", "cancelled"] as const
  const status = allowedStatuses.includes(settings.status as (typeof allowedStatuses)[number])
    ? (settings.status as SubscriptionAdminView["status"])
    : "paused"
  return {
    tenantId,
    tenantName: settings.tenantName,
    plan: settings.plan,
    status,
    seatLimit: settings.seatLimit,
    activeMemberCount: usage?.count ?? 0,
    startsAt: dateOnly(settings.startsAt),
    endsAt: dateOnly(settings.endsAt),
    defaultCurrency: settings.currency,
    invoices: invoices.map(toInvoiceView),
  }
}

export async function getSubscriptionAdminData(): Promise<SubscriptionAdminView> {
  const ctx = requirePlatformMaster(await requireContext())
  return runInTenant(ctx.tenantId, (tx) => loadView(tx, ctx.tenantId))
}

/** Issue the invoice and grant its seats immediately; payment is handled offline. */
export async function issueSeatLicence(
  input: IssueSeatLicenceInput
): Promise<ActionResult<SubscriptionAdminView>> {
  return runAction(async () => {
    const ctx = requirePlatformMaster(await requireContext())
    const plan = input.plan.trim()
    if (!plan || plan.length > 120) throw new Error("Plan name is required.")
    if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 10000) {
      throw new Error("Seats must be a whole number between 1 and 10,000.")
    }
    if (!Number.isFinite(input.seatPrice) || input.seatPrice < 0 || input.seatPrice > 100000000) {
      throw new Error("Enter a valid non-negative price per seat.")
    }
    if (!Number.isFinite(input.taxRate) || input.taxRate < 0 || input.taxRate > 100) {
      throw new Error("Tax rate must be between 0 and 100.")
    }
    if ((input.notes?.length ?? 0) > 2000) throw new Error("Notes must be 2,000 characters or fewer.")

    const startsAt = parseDate(input.startsAt, "Valid from")
    const endsAt = parseDate(input.endsAt, "Valid until", true)
    if (startsAt > endsAt) throw new Error("Valid from must be before valid until.")
    const dueAt = input.dueAt ? parseDate(input.dueAt, "Due date", true) : null
    const subtotal = money(input.seatPrice * input.seats)
    const taxAmount = money(subtotal * (input.taxRate / 100))
    const total = money(subtotal + taxAmount)
    const now = new Date()

    const view = await runInTenant(ctx.tenantId, async (tx) => {
      const [settings] = await tx
        .select({ currency: tenantSettings.defaultCurrency })
        .from(tenantSettings)
        .where(eq(tenantSettings.organizationId, ctx.tenantId))
        .limit(1)
      const [usage] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(membershipProfiles)
        .innerJoin(member, eq(member.id, membershipProfiles.memberId))
        .innerJoin(user, eq(user.id, member.userId))
        .where(
          and(
            eq(membershipProfiles.tenantId, ctx.tenantId),
            eq(membershipProfiles.status, "active"),
            ne(user.isSuperadmin, true)
          )
        )
      if (input.seats < (usage?.count ?? 0)) {
        throw new Error(`Issue at least ${usage?.count ?? 0} seats for the active tenant users.`)
      }

      const id = randomUUID()
      const invoiceNumber = `SUB-${now.getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`
      const [invoice] = await tx
        .insert(platformSubscriptionInvoices)
        .values({
          id,
          tenantId: ctx.tenantId,
          invoiceNumber,
          status: "issued",
          plan,
          currency: settings?.currency ?? "MYR",
          seatOperation: "set",
          additionalSeats: input.seats,
          seatPriceFullTerm: money(input.seatPrice).toFixed(2),
          prorationFactor: "1.00000000",
          subtotal: subtotal.toFixed(2),
          taxRate: input.taxRate.toFixed(3),
          taxAmount: taxAmount.toFixed(2),
          total: total.toFixed(2),
          subscriptionStartsAt: startsAt,
          subscriptionEndsAt: endsAt,
          issuedAt: now,
          dueAt,
          notes: input.notes?.trim() || null,
          createdBy: ctx.userId,
        })
        .returning()
      await tx
        .update(tenantSettings)
        .set({
          subscriptionPlan: plan,
          subscriptionStatus: "active",
          subscriptionSeatLimit: input.seats,
          subscriptionStartsAt: startsAt,
          subscriptionEndsAt: endsAt,
          updatedAt: now,
        })
        .where(eq(tenantSettings.organizationId, ctx.tenantId))
      await writeAudit(tx, ctx, {
        action: "subscription.seats_issued",
        entityType: "platform_subscription_invoice",
        entityId: invoice.id,
        after: {
          invoiceNumber,
          plan,
          seats: input.seats,
          startsAt,
          endsAt,
          total,
        },
      })
      return loadView(tx, ctx.tenantId)
    })

    revalidatePath("/settings/subscription")
    revalidatePath("/team")
    revalidatePath("/", "layout")
    return view
  })
}
