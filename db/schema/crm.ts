import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  jsonb,
  timestamp,
  unique,
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
    accountType: text("account_type"),
    industry: text("industry"),
    website: text("website"),
    /** Company registration number (e.g. SSM no.). */
    registrationNumber: text("registration_number"),
    /** Structured address: { line1, line2, city, state, postcode, country }. */
    billingAddress: jsonb("billing_address"),
    ownerMemberId: text("owner_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    customFields: jsonb("custom_fields").notNull().default({}),
    ...timestamps,
    ...softDelete,
  },
  (t) => [unique("accounts_tenant_id_uq").on(t.tenantId, t.id)]
)

/** Contacts — a person always lives under an account. */
export const persons = pgTable("persons", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  title: text("title"),
  email: text("email"),
  phone: text("phone"),
  isPrimary: boolean("is_primary").notNull().default(false),
  customFields: jsonb("custom_fields").notNull().default({}),
  ...timestamps,
  ...softDelete,
})

/** Raw inbound interest before conversion into account + person + opportunity. */
export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  companyName: text("company_name"),
  email: text("email"),
  phone: text("phone"),
  source: text("source"),
  status: leadStatus("status").notNull().default("new"),
  disqualifyReason: text("disqualify_reason"),
  // A lead can sit in a pipeline stage of its own (FK-less to avoid an
  // import cycle with pipeline.ts; resolved in the app layer).
  funnelId: uuid("funnel_id"),
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
  // references opportunities (defined in pipeline.ts) — kept FK-less to avoid an import cycle
  convertedOpportunityId: uuid("converted_opportunity_id"),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  ...timestamps,
  ...softDelete,
})
