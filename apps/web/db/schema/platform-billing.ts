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
    additionalSeats: integer("additional_seats").notNull(),
    seatPriceFullTerm: numeric("seat_price_full_term", {
      precision: 14,
      scale: 2,
    }).notNull(),
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
