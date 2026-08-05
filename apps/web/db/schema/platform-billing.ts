import {
  char,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { organization, user } from "./auth"
import { timestamps } from "./_helpers"

export const platformSubscriptionInvoiceStatus = pgEnum(
  "platform_subscription_invoice_status",
  ["draft", "issued", "paid", "void"]
)

/**
 * Commercial invoices issued by the platform operator to a tenant.
 *
 * These deliberately live outside `finance_docs`: tenant finance documents
 * represent the tenant's own O2C/P2P activity, whereas these invoices are the
 * platform operator charging the tenant for CRM seats.
 */
export const platformSubscriptionInvoices = pgTable(
  "platform_subscription_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceNumber: text("invoice_number").notNull(),
    status: platformSubscriptionInvoiceStatus("status")
      .notNull()
      .default("draft"),
    plan: text("plan").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** `set` establishes/replaces the licensed total; `add` is a mid-term increment. */
    seatOperation: text("seat_operation")
      .$type<"set" | "add">()
      .notNull()
      .default("add"),
    additionalSeats: integer("additional_seats").notNull(),
    seatPriceFullTerm: numeric("seat_price_full_term", {
      precision: 14,
      scale: 2,
    }).notNull(),
    /** Recurring price for one seat for one monthly billing period. */
    monthlySeatPrice: numeric("monthly_seat_price", { precision: 14, scale: 2 }),
    /** Number of monthly billing periods represented by this contract. */
    billingPeriodCount: integer("billing_period_count"),
    collectionFrequency: text("collection_frequency")
      .$type<"monthly" | "upfront">(),
    prorationFactor: numeric("proration_factor", {
      precision: 9,
      scale: 8,
    }).notNull(),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
    taxRate: numeric("tax_rate", { precision: 6, scale: 3 })
      .notNull()
      .default("0"),
    taxAmount: numeric("tax_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    total: numeric("total", { precision: 14, scale: 2 }).notNull(),
    subscriptionStartsAt: timestamp("subscription_starts_at", {
      withTimezone: true,
    }).notNull(),
    subscriptionEndsAt: timestamp("subscription_ends_at", {
      withTimezone: true,
    }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    paymentReference: text("payment_reference"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    unique("platform_subscription_invoices_number_uq").on(t.invoiceNumber),
    index("platform_subscription_invoices_tenant_created_idx").on(
      t.tenantId,
      t.createdAt
    ),
  ]
)

/** Operator-side collection schedule generated with a subscription invoice. */
export const platformSubscriptionCollectionMilestones = pgTable(
  "platform_subscription_collection_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => platformSubscriptionInvoices.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    ...timestamps,
  },
  (t) => [
    unique("platform_subscription_collection_milestones_invoice_sequence_uq").on(
      t.invoiceId,
      t.sequence
    ),
    index("platform_subscription_collection_milestones_tenant_due_idx").on(
      t.tenantId,
      t.dueAt
    ),
  ]
)
