/**
 * Tables that hold the client's deferred Salesforce objects so their data
 * migrates 1:1 (Lead's Company, Opportunity Product, Contract). They carry the
 * business fields for import + future modules; UI/automation stays plugin-gated.
 */
import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  integer,
  index,
} from "drizzle-orm/pg-core"
import { organization, member } from "./auth"
import { accounts, leads } from "./crm"
import { funnels } from "./pipeline"
import { products } from "./products"
import { timestamps, softDelete } from "./_helpers"

/** Lead's Company (Salesforce Company__c) — a company attached to a lead. */
export const leadCompanies = pgTable(
  "lead_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    address: text("address"),
    website: text("website"),
    phone: text("phone"),
    relationship: text("relationship"),
    companyCode: text("company_code"),
    assignmentIndicator: text("assignment_indicator"),
    ownerMemberId: text("owner_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [index("lead_companies_tenant_idx").on(t.tenantId)]
)

/** Opportunity Product (Salesforce OpportunityLineItem) — a product line on a funnel. */
export const opportunityProducts = pgTable(
  "opportunity_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    funnelId: uuid("funnel_id")
      .notNull()
      .references(() => funnels.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
    discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
    itemDiscount: numeric("item_discount", { precision: 14, scale: 2 }),
    totalPrice: numeric("total_price", { precision: 14, scale: 2 }),
    productCategory: text("product_category"),
    uom: text("uom"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("opportunity_products_funnel_idx").on(t.tenantId, t.funnelId)]
)

/** Contract (Salesforce Contract) — full contract lifecycle record. */
export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    funnelId: uuid("funnel_id").references(() => funnels.id, {
      onDelete: "set null",
    }),
    contractNumber: text("contract_number"),
    name: text("name"),
    startDate: date("start_date"),
    contractTerm: integer("contract_term"),
    status: text("status"),
    customerSignedTitle: text("customer_signed_title"),
    customerSignedDate: date("customer_signed_date"),
    activatedDate: date("activated_date"),
    orderNumber: text("order_number"),
    specialTerms: text("special_terms"),
    ownerMemberId: text("owner_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("contracts_tenant_account_idx").on(t.tenantId, t.accountId)]
)
