import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  date,
  jsonb,
  timestamp,
  unique,
  index,
  foreignKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { organization, member } from "./auth"
import { timestamps, softDelete } from "./_helpers"

export const leadStatus = pgEnum("lead_status", [
  "new",
  "contacted",
  "qualified",
  "disqualified",
  "converted",
])

/** Customer organizations. Self-referential parent → child hierarchy. */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Short account code, used in project codes. */
    code: text("code"),
    parentAccountId: uuid("parent_account_id").references(
      (): AnyPgColumn => accounts.id,
      { onDelete: "set null" }
    ),
    /** "client" (end user) or "reseller" (channel). */
    accountType: text("account_type"),
    /** Explicit quotation template override for this account. */
    quotationTemplateCode: text("quotation_template_code"),
    /**
     * Customer lifecycle (Salesforce "Prospect → Customer"): false = prospect,
     * flipped true automatically when a funnel on this account reaches Closed Won.
     */
    isCustomer: boolean("is_customer").notNull().default(false),
    /** Budgeting date (Salesforce "Budgeting Date" — drives budget-expiry reminders). */
    budgetingDate: date("budgeting_date"),
    /** For reseller accounts: the end-user client account. */
    endUserAccountId: uuid("end_user_account_id").references(
      (): AnyPgColumn => accounts.id,
      { onDelete: "set null" }
    ),
    industry: text("industry"),
    website: text("website"),
    /** Main office / switchboard phone number. */
    phone: text("phone"),
    /** Company registration number (e.g. SSM no.). */
    registrationNumber: text("registration_number"),
    /** Structured address: { line1, line2, city, state, postcode, country }. */
    billingAddress: jsonb("billing_address"),
    ownerMemberId: text("owner_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    // DEPRECATED / UNIMPLEMENTED: custom fields were never wired into the app
    // (no definitions UI, no read/validation path) and CUSTOM_FIELD_MANAGE was
    // removed. Kept only to avoid a destructive migration. See db/schema/system.ts.
    customFields: jsonb("custom_fields").notNull().default({}),
    ...timestamps,
    ...softDelete,
  },
  (t) => [unique("accounts_tenant_id_uq").on(t.tenantId, t.id)]
)

/** Contacts — a person always lives under an account. */
export const persons = pgTable(
  "persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Tenant-safe composite FK -> accounts(tenant_id, id); see table config below.
    accountId: uuid("account_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  title: text("title"),
  department: text("department"),
  email: text("email"),
  phone: text("phone"),
    /** Contact owner (Salesforce "Contact Owner"). */
    ownerMemberId: text("owner_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    country: text("country"),
    isPrimary: boolean("is_primary").notNull().default(false),
    // DEPRECATED / UNIMPLEMENTED: custom fields were never wired into the app
    // (no definitions UI, no read/validation path) and CUSTOM_FIELD_MANAGE was
    // removed. Kept only to avoid a destructive migration. See db/schema/system.ts.
    customFields: jsonb("custom_fields").notNull().default({}),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.accountId],
      foreignColumns: [accounts.tenantId, accounts.id],
      name: "persons_tenant_account_fk",
    }).onDelete("cascade"),
    index("persons_tenant_account_idx").on(t.tenantId, t.accountId),
  ]
)

/** Raw inbound interest before conversion into account + person + opportunity. */
export const leads = pgTable(
  "leads",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  companyName: text("company_name"),
  // Link to the lead's Company record (Salesforce Company__c) — FK-less to avoid
  // an import cycle with deferred-objects.ts; resolved in the app layer.
  leadCompanyId: uuid("lead_company_id"),
  email: text("email"),
  phone: text("phone"),
  mobile: text("mobile"),
  country: text("country"),
  source: text("source"),
  status: leadStatus("status").notNull().default("new"),
  disqualifyReason: text("disqualify_reason"),
  // A lead can sit in a pipeline stage of its own (FK-less to avoid an
  // import cycle with pipeline.ts; resolved in the app layer).
  pipelineId: uuid("pipeline_id"),
  currentStageId: uuid("current_stage_id"),
  ownerMemberId: text("owner_member_id").references(() => member.id, {
    onDelete: "set null",
  }),
  convertedAccountId: uuid("converted_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  convertedPersonId: uuid("converted_person_id").references(() => persons.id, {
    onDelete: "set null",
  }),
  // references funnels (defined in pipeline.ts) — kept FK-less to avoid an import cycle
  convertedOpportunityId: uuid("converted_opportunity_id"),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  ...timestamps,
  ...softDelete,
  },
  (t) => [index("leads_tenant_idx").on(t.tenantId)]
)
