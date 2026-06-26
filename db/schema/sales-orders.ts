import { pgTable, pgEnum, uuid, text, timestamp } from "drizzle-orm/pg-core"
import { organization, member } from "./auth"
import { projects } from "./projects"
import { timestamps } from "./_helpers"

export const salesOrderStatus = pgEnum("sales_order_status", [
  "submitted",
  "approved",
  "rejected",
])

/**
 * A sales-order submission against a project. The salesperson submits a
 * supporting document for sales-admin review. The SO number is auto-issued
 * ONLY when the submission is approved; rejection records a reason and the
 * salesperson can resubmit.
 */
export const salesOrders = pgTable("sales_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** Issued only on approval: {EntityCode}SO-0001. */
  soNumber: text("so_number"),
  /** What the document is identified as: "so" | "po" | "other". */
  documentKind: text("document_kind"),
  /** COD | 30 days | 45 days | 60 days | 90 days. */
  paymentTerm: text("payment_term"),
  status: salesOrderStatus("status").notNull().default("submitted"),
  submittedByMemberId: text("submitted_by_member_id").references(
    () => member.id,
    { onDelete: "set null" }
  ),
  reviewedByMemberId: text("reviewed_by_member_id").references(
    () => member.id,
    { onDelete: "set null" }
  ),
  rejectReason: text("reject_reason"),
  notes: text("notes"),
  submittedAt: timestamp("submitted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  ...timestamps,
})
