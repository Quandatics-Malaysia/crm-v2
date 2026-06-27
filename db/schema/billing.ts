import {
  pgTable,
  pgEnum,
  uuid,
  text,
  numeric,
  date,
  integer,
  index,
} from "drizzle-orm/pg-core"
import { organization } from "./auth"
import { projects } from "./projects"
import { quotations } from "./quotations"
import { timestamps } from "./_helpers"

export const paymentMilestoneStatus = pgEnum("payment_milestone_status", [
  "pending",
  "invoiced",
  "paid",
])

/**
 * A payment milestone on a delivery project, billed against the project's
 * source quotation (the single source of value). Milestones reconcile to the
 * quotation total. Invoice/payment logic comes later — status is the seam.
 */
export const paymentMilestones = pgTable(
  "payment_milestones",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** The quotation this milestone bills against (the project's value source). */
  quotationId: uuid("quotation_id").references(() => quotations.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  /** Optional share of the quotation total (display/derivation aid). */
  percentage: numeric("percentage", { precision: 5, scale: 2 }),
  dueDate: date("due_date"),
  status: paymentMilestoneStatus("status").notNull().default("pending"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
  },
  (t) => [index("payment_milestones_project_idx").on(t.projectId)]
)
