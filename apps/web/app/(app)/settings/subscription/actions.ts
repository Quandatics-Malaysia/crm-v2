"use server"

import { randomUUID } from "node:crypto"
import { and, desc, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { runInTenant, type Tx } from "@/db"
import {
  membershipProfiles,
  organization,
  platformSubscriptionInvoices,
  tenantSettings,
} from "@/db/schema"
import { runAction, type ActionResult } from "@/lib/action-result"
import { requireContext } from "@/lib/actions"
import {
  calculateProratedSeatCharge,
  calculateProrationFraction,
} from "@/lib/subscription-proration"
import { writeAudit } from "@/server/audit"

const SUBSCRIPTION_STATUSES = [
  "active",
  "trial",
  "paused",
  "expired",
  "cancelled",
] as const

type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]
type InvoiceStatus = "draft" | "issued" | "paid" | "void"

export type SubscriptionInvoiceView = {
  id: string
  invoiceNumber: string
  status: InvoiceStatus
  plan: string
  currency: string
  seatOperation: "set" | "add"
  additionalSeats: number
  seatPriceFullTerm: number
  prorationFactor: number
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  subscriptionStartsAt: string
  subscriptionEndsAt: string
  issuedAt: string | null
  dueAt: string | null
  paidAt: string | null
  voidedAt: string | null
  paymentReference: string | null
  notes: string | null
  createdAt: string
}

export type SubscriptionAdminView = {
  tenantId: string
  tenantName: string
  plan: string
  status: SubscriptionStatus
  seatLimit: number | null
  activeMemberCount: number
  startsAt: string
  endsAt: string
  defaultCurrency: string
  invoices: SubscriptionInvoiceView[]
}

export type UpdateSubscriptionInput = {
  plan: string
  status: SubscriptionStatus
  startsAt: string
  endsAt: string
}

export type CreateSubscriptionInvoiceInput = {
  seatOperation: "set" | "add"
  additionalSeats: number
  seatPriceFullTerm: number
  taxRate: number
  dueAt: string
  notes?: string
}

function requirePlatformMaster<T extends { isSuperadmin: boolean; tenantId: string }>(
  ctx: T
): T {
  if (!ctx.isSuperadmin) throw new Error("Only the platform master can manage subscriptions.")
  if (!ctx.tenantId) throw new Error("Select an organization before managing its subscription.")
  return ctx
}

function parseDate(value: string, field: string, endOfDay = false): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be a valid date.`)
  }
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"
  const date = new Date(`${value}${suffix}`)
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date.`)
  return date
}

function dateOnly(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : ""
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function money(value: number): number {
  return Math.round(value * 100) / 100
}

function toInvoiceView(
  row: typeof platformSubscriptionInvoices.$inferSelect
): SubscriptionInvoiceView {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    status: row.status,
    plan: row.plan,
    currency: row.currency,
    seatOperation: row.seatOperation,
    additionalSeats: row.additionalSeats,
    seatPriceFullTerm: Number(row.seatPriceFullTerm),
    prorationFactor: Number(row.prorationFactor),
    subtotal: Number(row.subtotal),
    taxRate: Number(row.taxRate),
    taxAmount: Number(row.taxAmount),
    total: Number(row.total),
    subscriptionStartsAt: dateOnly(row.subscriptionStartsAt),
    subscriptionEndsAt: dateOnly(row.subscriptionEndsAt),
    issuedAt: iso(row.issuedAt),
    dueAt: iso(row.dueAt),
    paidAt: iso(row.paidAt),
    voidedAt: iso(row.voidedAt),
    paymentReference: row.paymentReference,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  }
}

async function loadSubscriptionAdminView(
  tx: Tx,
  tenantId: string
): Promise<SubscriptionAdminView> {
  const [settings] = await tx
    .select({
      plan: tenantSettings.subscriptionPlan,
      status: tenantSettings.subscriptionStatus,
      seatLimit: tenantSettings.subscriptionSeatLimit,
      startsAt: tenantSettings.subscriptionStartsAt,
      endsAt: tenantSettings.subscriptionEndsAt,
      defaultCurrency: tenantSettings.defaultCurrency,
      tenantName: organization.name,
    })
    .from(tenantSettings)
    .innerJoin(organization, eq(organization.id, tenantSettings.organizationId))
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1)
  if (!settings) throw new Error("Tenant settings were not found.")

  const [usage] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(membershipProfiles)
    .where(
      and(
        eq(membershipProfiles.tenantId, tenantId),
        eq(membershipProfiles.status, "active")
      )
    )
  const invoices = await tx
    .select()
    .from(platformSubscriptionInvoices)
    .where(eq(platformSubscriptionInvoices.tenantId, tenantId))
    .orderBy(desc(platformSubscriptionInvoices.createdAt))

  const status = SUBSCRIPTION_STATUSES.includes(settings.status as SubscriptionStatus)
    ? (settings.status as SubscriptionStatus)
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
    defaultCurrency: settings.defaultCurrency,
    invoices: invoices.map(toInvoiceView),
  }
}

export async function getSubscriptionAdminData(): Promise<SubscriptionAdminView> {
  const ctx = requirePlatformMaster(await requireContext())
  return runInTenant(ctx.tenantId, (tx) =>
    loadSubscriptionAdminView(tx, ctx.tenantId)
  )
}

export async function updateSubscriptionConfiguration(
  input: UpdateSubscriptionInput
): Promise<ActionResult<SubscriptionAdminView>> {
  return runAction(async () => {
    const ctx = requirePlatformMaster(await requireContext())
    const plan = input.plan.trim()
    if (!plan || plan.length > 120) throw new Error("Plan name is required.")
    if (!SUBSCRIPTION_STATUSES.includes(input.status)) {
      throw new Error("Subscription status is invalid.")
    }
    const startsAt = parseDate(input.startsAt, "Start date")
    const endsAt = parseDate(input.endsAt, "End date", true)
    if (startsAt > endsAt) throw new Error("Start date must be before the end date.")

    const view = await runInTenant(ctx.tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(tenantSettings)
        .where(eq(tenantSettings.organizationId, ctx.tenantId))
        .limit(1)
      if (!before) throw new Error("Tenant settings were not found.")
      await tx
        .update(tenantSettings)
        .set({
          subscriptionPlan: plan,
          subscriptionStatus: input.status,
          subscriptionStartsAt: startsAt,
          subscriptionEndsAt: endsAt,
          updatedAt: new Date(),
        })
        .where(eq(tenantSettings.organizationId, ctx.tenantId))
      await writeAudit(tx, ctx, {
        action: "subscription.configuration_updated",
        entityType: "tenant_settings",
        entityId: ctx.tenantId,
        before: {
          plan: before.subscriptionPlan,
          status: before.subscriptionStatus,
          startsAt: before.subscriptionStartsAt,
          endsAt: before.subscriptionEndsAt,
        },
        after: { plan, status: input.status, startsAt, endsAt },
      })
      return loadSubscriptionAdminView(tx, ctx.tenantId)
    })
    revalidatePath("/settings/subscription")
    revalidatePath("/team")
    return view
  })
}

export async function createSubscriptionInvoice(
  input: CreateSubscriptionInvoiceInput
): Promise<ActionResult<SubscriptionInvoiceView>> {
  return runAction(async () => {
    const ctx = requirePlatformMaster(await requireContext())
    if (!Number.isInteger(input.additionalSeats) || input.additionalSeats < 1 || input.additionalSeats > 10000) {
      throw new Error("Seats must be a whole number between 1 and 10,000.")
    }
    if (!Number.isFinite(input.seatPriceFullTerm) || input.seatPriceFullTerm < 0 || input.seatPriceFullTerm > 100000000) {
      throw new Error("Enter a valid non-negative seat price.")
    }
    if (!Number.isFinite(input.taxRate) || input.taxRate < 0 || input.taxRate > 100) {
      throw new Error("Tax rate must be between 0 and 100.")
    }
    if ((input.notes?.length ?? 0) > 2000) throw new Error("Notes must be 2,000 characters or fewer.")
    const dueAt = parseDate(input.dueAt, "Due date", true)
    if (input.seatOperation !== "set" && input.seatOperation !== "add") {
      throw new Error("Invoice seat operation is invalid.")
    }

    const created = await runInTenant(ctx.tenantId, async (tx) => {
      const [settings] = await tx
        .select()
        .from(tenantSettings)
        .where(eq(tenantSettings.organizationId, ctx.tenantId))
        .limit(1)
      if (!settings?.subscriptionStartsAt || !settings.subscriptionEndsAt) {
        throw new Error("Save the subscription start and end dates before creating an invoice.")
      }
      if (settings.subscriptionSeatLimit == null && input.seatOperation !== "set") {
        throw new Error("The first subscription invoice must establish the licensed seat total.")
      }
      const now = new Date()
      const subtotal = calculateProratedSeatCharge({
        seatPrice: input.seatPriceFullTerm,
        additionalSeats: input.additionalSeats,
        // Initial subscriptions and renewals charge the complete billing
        // period. Only seats added to an existing term are prorated.
        startsAt: input.seatOperation === "add" ? settings.subscriptionStartsAt : null,
        endsAt: input.seatOperation === "add" ? settings.subscriptionEndsAt : null,
        now,
      })
      const factor = input.seatOperation === "add"
        ? calculateProrationFraction({
            startsAt: settings.subscriptionStartsAt,
            endsAt: settings.subscriptionEndsAt,
            now,
          })
        : 1
      const taxAmount = money(subtotal * (input.taxRate / 100))
      const total = money(subtotal + taxAmount)
      const id = randomUUID()
      const invoiceNumber = `SUB-${now.getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`
      const [row] = await tx
        .insert(platformSubscriptionInvoices)
        .values({
          id,
          tenantId: ctx.tenantId,
          invoiceNumber,
          plan: settings.subscriptionPlan,
          currency: settings.defaultCurrency,
          seatOperation: input.seatOperation,
          additionalSeats: input.additionalSeats,
          seatPriceFullTerm: money(input.seatPriceFullTerm).toFixed(2),
          prorationFactor: factor.toFixed(8),
          subtotal: subtotal.toFixed(2),
          taxRate: input.taxRate.toFixed(3),
          taxAmount: taxAmount.toFixed(2),
          total: total.toFixed(2),
          subscriptionStartsAt: settings.subscriptionStartsAt,
          subscriptionEndsAt: settings.subscriptionEndsAt,
          dueAt,
          notes: input.notes?.trim() || null,
          createdBy: ctx.userId,
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "subscription.invoice_created",
        entityType: "platform_subscription_invoice",
        entityId: row.id,
        after: toInvoiceView(row),
      })
      return toInvoiceView(row)
    })
    revalidatePath("/settings/subscription")
    return created
  })
}

export async function issueSubscriptionInvoice(
  invoiceId: string
): Promise<ActionResult<SubscriptionInvoiceView>> {
  return runAction(async () => {
    const ctx = requirePlatformMaster(await requireContext())
    const updated = await runInTenant(ctx.tenantId, async (tx) => {
      const [current] = await tx
        .select()
        .from(platformSubscriptionInvoices)
        .where(and(eq(platformSubscriptionInvoices.id, invoiceId), eq(platformSubscriptionInvoices.tenantId, ctx.tenantId)))
        .for("update")
        .limit(1)
      if (!current) throw new Error("Invoice was not found.")
      if (current.status !== "draft") throw new Error("Only a draft invoice can be issued.")
      const [row] = await tx
        .update(platformSubscriptionInvoices)
        .set({ status: "issued", issuedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(platformSubscriptionInvoices.id, invoiceId), eq(platformSubscriptionInvoices.tenantId, ctx.tenantId)))
        .returning()
      await writeAudit(tx, ctx, {
        action: "subscription.invoice_issued",
        entityType: "platform_subscription_invoice",
        entityId: row.id,
        before: { status: current.status },
        after: { status: row.status, issuedAt: row.issuedAt },
      })
      return toInvoiceView(row)
    })
    revalidatePath("/settings/subscription")
    return updated
  })
}

export async function markSubscriptionInvoicePaid(
  invoiceId: string,
  paymentReference: string
): Promise<ActionResult<SubscriptionAdminView>> {
  return runAction(async () => {
    const ctx = requirePlatformMaster(await requireContext())
    const reference = paymentReference.trim()
    if (!reference) throw new Error("Payment reference is required before marking an invoice paid.")
    if (reference.length > 200) throw new Error("Payment reference must be 200 characters or fewer.")

    const view = await runInTenant(ctx.tenantId, async (tx) => {
      const [invoice] = await tx
        .select()
        .from(platformSubscriptionInvoices)
        .where(and(eq(platformSubscriptionInvoices.id, invoiceId), eq(platformSubscriptionInvoices.tenantId, ctx.tenantId)))
        .for("update")
        .limit(1)
      if (!invoice) throw new Error("Invoice was not found.")
      if (invoice.status !== "issued") throw new Error("Only an issued invoice can be marked paid.")

      const [settings] = await tx
        .select()
        .from(tenantSettings)
        .where(eq(tenantSettings.organizationId, ctx.tenantId))
        .for("update")
        .limit(1)
      if (!settings) throw new Error("Tenant settings were not found.")
      const [usage] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(membershipProfiles)
        .where(
          and(
            eq(membershipProfiles.tenantId, ctx.tenantId),
            eq(membershipProfiles.status, "active")
          )
        )
      const currentSeatLimit = settings.subscriptionSeatLimit ?? 0
      if (settings.subscriptionSeatLimit == null && invoice.seatOperation !== "set") {
        throw new Error("The first paid invoice must establish the licensed seat total.")
      }
      const newSeatLimit = invoice.seatOperation === "set"
        ? invoice.additionalSeats
        : currentSeatLimit + invoice.additionalSeats
      if (newSeatLimit < (usage?.count ?? 0)) {
        throw new Error(`The paid seat total must cover all ${usage?.count ?? 0} active members.`)
      }

      const paidAt = new Date()
      await tx
        .update(platformSubscriptionInvoices)
        .set({
          status: "paid",
          paidAt,
          paymentReference: reference || null,
          updatedAt: paidAt,
        })
        .where(and(eq(platformSubscriptionInvoices.id, invoice.id), eq(platformSubscriptionInvoices.tenantId, ctx.tenantId)))
      await tx
        .update(tenantSettings)
        .set({ subscriptionSeatLimit: newSeatLimit, updatedAt: paidAt })
        .where(eq(tenantSettings.organizationId, ctx.tenantId))
      await writeAudit(tx, ctx, {
        action: "subscription.invoice_paid",
        entityType: "platform_subscription_invoice",
        entityId: invoice.id,
        before: { status: invoice.status, subscriptionSeatLimit: settings.subscriptionSeatLimit },
        after: {
          status: "paid",
          paidAt,
          paymentReference: reference || null,
          seatOperation: invoice.seatOperation,
          additionalSeats: invoice.additionalSeats,
          subscriptionSeatLimit: newSeatLimit,
        },
      })
      return loadSubscriptionAdminView(tx, ctx.tenantId)
    })
    revalidatePath("/settings/subscription")
    revalidatePath("/team")
    return view
  })
}

export async function voidSubscriptionInvoice(
  invoiceId: string
): Promise<ActionResult<SubscriptionInvoiceView>> {
  return runAction(async () => {
    const ctx = requirePlatformMaster(await requireContext())
    const updated = await runInTenant(ctx.tenantId, async (tx) => {
      const [current] = await tx
        .select()
        .from(platformSubscriptionInvoices)
        .where(and(eq(platformSubscriptionInvoices.id, invoiceId), eq(platformSubscriptionInvoices.tenantId, ctx.tenantId)))
        .for("update")
        .limit(1)
      if (!current) throw new Error("Invoice was not found.")
      if (current.status !== "draft" && current.status !== "issued") {
        throw new Error("Only a draft or issued invoice can be voided.")
      }
      const [row] = await tx
        .update(platformSubscriptionInvoices)
        .set({ status: "void", voidedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(platformSubscriptionInvoices.id, invoiceId), eq(platformSubscriptionInvoices.tenantId, ctx.tenantId)))
        .returning()
      await writeAudit(tx, ctx, {
        action: "subscription.invoice_voided",
        entityType: "platform_subscription_invoice",
        entityId: row.id,
        before: { status: current.status },
        after: { status: row.status, voidedAt: row.voidedAt },
      })
      return toInvoiceView(row)
    })
    revalidatePath("/settings/subscription")
    return updated
  })
}
