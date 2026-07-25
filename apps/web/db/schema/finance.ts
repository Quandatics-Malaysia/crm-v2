import {
  pgTable,
  pgEnum,
  uuid,
  text,
  numeric,
  char,
  date,
  integer,
  timestamp,
  unique,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization } from "./auth"
import { salesOrders } from "./sales-orders"
import { projects } from "./projects"
import { paymentMilestones } from "./billing"
import { intercompanyDeals } from "./intercompany"
import { timestamps } from "./_helpers"

export const financeDocKind = pgEnum("finance_doc_kind", [
  // order-to-cash (sale direction)
  "delivery_order",
  "invoice",
  "credit_note",
  "receipt",
  // procure-to-pay (purchase direction)
  "rfq",
  "purchase_order",
  "purchase_invoice",
  "payment",
])

export const financeDocStatus = pgEnum("finance_doc_status", [
  "draft",
  "issued",
  "settled",
  "cancelled",
])

/**
 * ONE table for the whole O2C + P2P document chain (DO → Invoice → CN/Receipt;
 * RFQ → PO → Purchase invoice → Payment). Which kind may hang off which parent
 * is enforced by the pure config in lib/finance-kinds.ts, not per-kind tables —
 * the chain is the data (`parent_id`), the rules are one map.
 *
 * The module is an ADD-ON: gated everywhere by tenant_settings.finance_module
 * (backend flag, default off) so existing tenants are untouched until enabled.
 */
export const financeDocs = pgTable(
  "finance_docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: financeDocKind("kind").notNull(),
    /** Minted {ENTITY}{PREFIX}-0001 (unique per tenant across all kinds). */
    number: text("number").notNull(),
    /** Chain link to the upstream document (invoice → DO, receipt → invoice…). */
    parentId: uuid("parent_id").references((): AnyPgColumn => financeDocs.id, {
      onDelete: "set null",
    }),
    /** Root anchor: the approved sales order this chain hangs off. */
    salesOrderId: uuid("sales_order_id").references(() => salesOrders.id, {
      onDelete: "set null",
    }),
    /** Denormalized from the sales order for the project view / reporting. */
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    /** Invoice ↔ payment-milestone tie: issue → invoiced, receipt → paid. */
    milestoneId: uuid("milestone_id").references(() => paymentMilestones.id, {
      onDelete: "set null",
    }),
    // ponytail: party as free text (customer prefilled from the project's
    // account; supplier typed). Promote to a vendor table when procurement grows.
    partyName: text("party_name"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    status: financeDocStatus("status").notNull().default("draft"),
    docDate: date("doc_date"),
    dueDate: date("due_date"),
    notes: text("notes"),
    /** How many payment reminders have been logged (0 = none yet). */
    reminderStage: integer("reminder_stage").notNull().default(0),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    /** Set on intercompany auto-mirrored documents (both sides of the pair). */
    intercompanyDealId: uuid("intercompany_deal_id").references(
      () => intercompanyDeals.id,
      { onDelete: "set null" }
    ),
    /**
     * The other half of an auto-mirrored interco pair (origin's purchase
     * invoice ↔ partner's sales invoice). Cross-tenant by design — FK
     * integrity ignores RLS; reads stay tenant-scoped.
     */
    counterpartDocId: uuid("counterpart_doc_id").references(
      (): AnyPgColumn => financeDocs.id,
      { onDelete: "set null" }
    ),
    /** Counterpart's number, denormalized at mirror time — RLS blocks a
     *  cross-tenant join, so the display value must live on the row. */
    counterpartNumber: text("counterpart_number"),
    ...timestamps,
  },
  (t) => [
    unique("finance_docs_number_uq").on(t.tenantId, t.number),
    index("finance_docs_tenant_kind_idx").on(t.tenantId, t.kind),
    index("finance_docs_parent_idx").on(t.parentId),
    index("finance_docs_project_idx").on(t.projectId),
    // One LIVE invoice per milestone — the DB-level guard against double-billing.
    uniqueIndex("finance_docs_live_milestone_uq")
      .on(t.milestoneId)
      .where(sql`status <> 'cancelled'`),
  ]
)
