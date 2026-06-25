import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  char,
  jsonb,
  unique,
  primaryKey,
} from "drizzle-orm/pg-core"
import { organization, member } from "./auth"
import { timestamps } from "./_helpers"

export const orgStatus = pgEnum("org_status", ["active", "suspended"])
export const memberStatus = pgEnum("member_status", ["active", "invited", "disabled"])

/** Per-tenant configuration flags (1:1 with organization). */
export const tenantSettings = pgTable("tenant_settings", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  defaultCurrency: char("default_currency", { length: 3 }).notNull().default("MYR"),
  status: orgStatus("status").notNull().default("active"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  approvalBypassTier: integer("approval_bypass_tier").notNull().default(40),
  taxInclusive: boolean("tax_inclusive").notNull().default(false),
  autoWinOnQuoteAccept: boolean("auto_win_on_quote_accept").notNull().default(true),
  allowPasswordLogin: boolean("allow_password_login").notNull().default(false),
  /** Configurable industry picklist for accounts. */
  industries: jsonb("industries").$type<string[]>(),
  /** Quotation numbering config. */
  quotePrefix: text("quote_prefix").notNull().default("Q-"),
  quoteNextNumber: integer("quote_next_number").notNull().default(1),
  quotePadWidth: integer("quote_pad_width").notNull().default(4),
  /** SO numbering config (per entity): {EntityCode}SO-0001. */
  soNextNumber: integer("so_next_number").notNull().default(1),
  soPadWidth: integer("so_pad_width").notNull().default(4),
  /** Short code for this entity, used in project codes ({YY}-{Entity}-{Account}-{n}). */
  entityCode: text("entity_code"),
  projectNextNumber: integer("project_next_number").notNull().default(1),
  projectPadWidth: integer("project_pad_width").notNull().default(3),
  ...timestamps,
})

/** Tenant-scoped named roles, each with a baseline seniority tier. */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    defaultTierLevel: integer("default_tier_level").notNull().default(0),
    ...timestamps,
  },
  (t) => [unique("roles_tenant_name_uq").on(t.tenantId, t.name)]
)

/** Global capability catalog (resource.action). Not tenant-scoped. */
export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  description: text("description"),
})

/** Role ↔ permission assignment (tenant-scoped for RLS uniformity). */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })]
)

/**
 * CRM-specific extension of a Better Auth `member` (1:1).
 * Carries the seniority tier and the self-referential upline pointer
 * used for stage-approval routing.
 */
export const membershipProfiles = pgTable("membership_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: text("member_id")
    .notNull()
    .unique()
    .references(() => member.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),
  tierLevel: integer("tier_level").notNull().default(0),
  // upline / manager — references another member in the same tenant
  managerMemberId: text("manager_member_id").references(() => member.id, {
    onDelete: "set null",
  }),
  status: memberStatus("status").notNull().default("active"),
  ...timestamps,
})
