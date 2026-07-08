import {
  pgTable,
  pgEnum,
  uuid,
  text,
  numeric,
  date,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core"
import { organization } from "./auth"
import { projects } from "./projects"
import { funnels } from "./pipeline"
import { quotations } from "./quotations"
import { timestamps } from "./_helpers"

export const paymentMilestoneStatus = pgEnum("payment_milestone_status", [
  "pending",
  "invoiced",
  "paid",
])

/**
 * A payment milestone on a delivery project. Milestones reconcile to the
 * PROJECT's value (see allocatedTotal in projects/actions.ts — the sum of
 * milestone amounts may never exceed it, and the value may never drop below
 * what's allocated). `quotationId` records which quotation a milestone bills
 * against for traceability, but the project value — seeded from the accepted
 * quote's net and thereafter owned by the project — is the reconciliation
 * baseline. Invoice/payment logic comes later — status is the seam.
 */
export const paymentMilestones = pgTable(
  "payment_milestones",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  // Nullable: imported Salesforce milestones attach to a FUNNEL, not always a
  // crm-v2 delivery project.
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  /** Funnel this milestone belongs to (Salesforce Payment_Milestone.Funnels__c). */
  funnelId: uuid("funnel_id").references(() => funnels.id, { onDelete: "cascade" }),
  /** The quotation this milestone bills against (the project's value source). */
  quotationId: uuid("quotation_id").references(() => quotations.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  dueDate: date("due_date"),
  status: paymentMilestoneStatus("status").notNull().default("pending"),
  sortOrder: integer("sort_order").notNull().default(0),
  // Salesforce invoicing fields.
  splitPercentage: numeric("split_percentage", { precision: 6, scale: 2 }),
  invoiceNumber: text("invoice_number"),
  invoiceDate: date("invoice_date"),
  expectedInvoiceMonth: text("expected_invoice_month"),
  expectedInvoiceYear: integer("expected_invoice_year"),
  soNumber: text("so_number"),
  productCategory: text("product_category"),
  productSubcategory: text("product_subcategory"),
  isDefault: boolean("is_default").notNull().default(false),
  ...timestamps,
  },
  (t) => [
    index("payment_milestones_project_idx").on(t.projectId),
    index("payment_milestones_funnel_idx").on(t.tenantId, t.funnelId),
  ]
)
