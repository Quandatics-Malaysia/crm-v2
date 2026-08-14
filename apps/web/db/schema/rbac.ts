import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  char,
  jsonb,
  timestamp,
  unique,
  uniqueIndex,
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
  allowPasswordLogin: boolean("allow_password_login").notNull().default(true),
  /** Configurable industry picklist for accounts. */
  industries: jsonb("industries").$type<string[]>(),
  /**
   * Configurable country → states picklist for account addresses. Country is
   * required on an account; each country carries its own optional list of
   * states/provinces (the account form cascades state off the chosen country).
   */
  countries: jsonb("countries")
    .$type<{ name: string; states: string[] }[]>()
    .notNull()
    .default([]),
  /**
   * Tenant-managed project-nature picklist. Each entry is a short stable code +
   * a display name; the chosen code is snapshotted onto a project and used as
   * the PROJECTNATURE segment of its project code.
   */
  projectNatures: jsonb("product_types")
    .$type<{ code: string; name: string }[]>()
    .notNull()
    .default([]),
  /**
   * Tenant-managed product-code picklist (product lines). Each entry is a short
   * stable code + a display name; standardised products reference one of these.
   * Distinct from projectNatures (which drive project codes).
   */
  productCodes: jsonb("product_codes")
    .$type<{ code: string; name: string }[]>()
    .notNull()
    .default([]),
  /**
   * Tenant-defined custom funnel fields. Each is a stable `key` + display
   * `label`; salespeople fill them on the funnel (stored in
   * funnels.custom_fields), and admins can require them per stage
   * (pipeline_stages.required_fields references the key). See lib/stage-gate.ts.
   */
  customFunnelFields: jsonb("custom_funnel_fields")
    .$type<
      {
        key: string
        label: string
        type?: "text" | "number" | "date" | "checkbox" | "select"
        options?: string[]
        description?: string
        category?: string
      }[]
    >()
    .notNull()
    .default([]),
  /**
   * Email domains whose users auto-join this workspace on first SSO login
   * (Entra). Empty = no auto-join (invite-only).
   */
  autoJoinDomains: jsonb("auto_join_domains")
    .$type<string[]>()
    .notNull()
    .default([]),
  /** Role name granted to auto-joined users (falls back to "Rep"). */
  autoJoinRole: text("auto_join_role"),
  /**
   * Explicit allow-list of sibling entity (organization) ids this tenant may
   * pick as an intercompany handling partner. NULL/empty = legacy behavior
   * (any entity the acting user belongs to). Once configured, only listed
   * entities are valid partners — closes the hole where a user's unrelated
   * membership (consultant, test tenant) counts as a "sibling".
   */
  intercompanyPartnerIds: jsonb("intercompany_partner_ids").$type<string[]>(),
  /**
   * Tenant-managed ISO-4217 currency picklist for deal/quote forms.
   * NULL/empty = the built-in default set (lib/tenant-defaults.ts).
   */
  currencies: jsonb("currencies").$type<string[]>(),
  /**
   * Tenant-managed payment-term picklist for sales-order submissions.
   * NULL/empty = the built-in defaults (COD, 30/45/60/90 days).
   */
  paymentTerms: jsonb("payment_terms").$type<string[]>(),
  /**
   * Default quotation validity in days: prefills "Valid until" on a new quote
   * as today + N days. NULL = no prefill.
   */
  quoteValidDays: integer("quote_valid_days"),
  /** Dashboard "follow-ups due soon" window in days. NULL = 7. */
  followUpDueDays: integer("follow_up_due_days"),
  /**
   * Automation: when a quotation is accepted, auto-create the delivery
   * project from it (best-effort — skipped with a warning when the account
   * has no code or the actor lacks project.create).
   */
  autoCreateProjectOnAccept: boolean("auto_create_project_on_accept")
    .notNull()
    .default(false),
  /**
   * Payment-split template auto-seeded onto a new project that has a value:
   * each entry is a milestone title + percent of the project value. The last
   * milestone absorbs rounding so the sum always reconciles exactly.
   */
  milestoneTemplate: jsonb("milestone_template").$type<
    { title: string; percent: number }[]
  >(),
  /**
   * Nudge threshold: an OPEN funnel with no activity for this many days shows
   * on its owner's dashboard as stale. NULL = nudges off.
   */
  staleDealDays: integer("stale_deal_days"),
  /**
   * Automation: creating a lead also creates a "First contact" follow-up due
   * this many days later for the lead's owner. NULL = off.
   */
  leadFollowUpDays: integer("lead_follow_up_days"),
  /**
   * Legacy add-on field retained for schema compatibility; signed deployment
   * entitlement is authoritative (no tenant-facing ownership UI):
   * `UPDATE tenant_settings SET finance_module = true WHERE organization_id=…`.
   * Gates the O2C/P2P document chain (Billing + Purchasing pages, finance_docs).
   */
  financeModule: boolean("finance_module").notNull().default(false),
  /** In-app documentation (/documentation) — tenant-facing switch in
   *  Settings → Behavior; members also need the `docs.view` permission. */
  documentationModule: boolean("documentation_module").notNull().default(true),
  /** Subscription plan/seat license name used in billing/admin workflows. */
  subscriptionPlan: text("subscription_plan").notNull().default("Starter"),
  /** Subscription status: active allows seats; anything else blocks new activations. */
  subscriptionStatus: text("subscription_status").notNull().default("active"),
  /** Hard seat cap for active members; NULL means no hard cap. */
  subscriptionSeatLimit: integer("subscription_seat_limit"),
  /** Optional subscription window start/end controlled manually by operators. */
  subscriptionStartsAt: timestamp("subscription_starts_at", { withTimezone: true }),
  subscriptionEndsAt: timestamp("subscription_ends_at", { withTimezone: true }),
  /** Invoice reminder schedule: days AFTER the due date for reminder 1, 2, 3…
   *  NULL = built-in default (lib/tenant-defaults.ts). */
  invoiceReminderDays: jsonb("invoice_reminder_days").$type<number[]>(),
  /** Default invoice payment window: dueDate prefills docDate + N days. */
  invoiceDueDays: integer("invoice_due_days"),
  /** Automation: move a project to Completed when ALL its milestones are paid. */
  autoCompleteProjectOnPaid: boolean("auto_complete_project_on_paid")
    .notNull()
    .default(false),
  /** Automation: issuing a customer invoice on an intercompany project
   *  auto-drafts the mirrored pair (partner sales invoice ↔ origin purchase
   *  invoice) for the partner share. */
  intercoAutoMirror: boolean("interco_auto_mirror").notNull().default(true),
  /** Preset country for new account addresses (from the countries picklist). */
  defaultCountry: text("default_country"),
  /** Preset dialing prefix (e.g. "+60 ") prefilled into empty phone fields. */
  phonePrefix: text("phone_prefix"),
  /** Where a lead came from (picklist; NULL/empty = built-in defaults). */
  leadSources: jsonb("lead_sources").$type<string[]>(),
  /** Deal-lost / lead-disqualify reasons (shared picklist; NULL = defaults). */
  lossReasons: jsonb("loss_reasons").$type<string[]>(),
  /** Sales-order document kinds (picklist; NULL/empty = built-in defaults). */
  soDocumentKinds: jsonb("so_document_kinds").$type<string[]>(),
  // ── Company profile — rendered onto customer-facing documents (quotes) ──
  /** Postal address block (multiline). */
  companyAddress: text("company_address"),
  companyRegistrationNo: text("company_registration_no"),
  companyPhone: text("company_phone"),
  companyEmail: text("company_email"),
  companyWebsite: text("company_website"),
  /** Bank / payment instructions block (multiline), printed on quotes. */
  bankDetails: text("bank_details"),
  /** Footer / terms & conditions text printed at the bottom of quotes. */
  quoteFooter: text("quote_footer"),
  /** Storage key + content type of the uploaded company logo. */
  logoStorageKey: text("logo_storage_key"),
  logoContentType: text("logo_content_type"),
  /** Quotation numbering config. */
  quotePrefix: text("quote_prefix").notNull().default("Q-"),
  quoteNextNumber: integer("quote_next_number").notNull().default(1),
  quotePadWidth: integer("quote_pad_width").notNull().default(4),
  /** SO numbering config (per entity): {EntityCode}SO-0001. */
  soNextNumber: integer("so_next_number").notNull().default(1),
  soPadWidth: integer("so_pad_width").notNull().default(4),
  /** Short code for this entity, used in project codes ({YYYY}-{Entity}-{Account}-{ProjectNature}-{n}). */
  entityCode: text("entity_code"),
  /** Tenant-level quotation template key; if unset use "default". */
  quotationTemplateCode: text("quotation_template_code"),
  /**
   * DEPRECATED for projects: the per-year running number now lives in
   * `project_counters` (keyed by tenant + year). Kept to avoid a destructive
   * migration; do not use for new project numbering.
   */
  projectNextNumber: integer("project_next_number").notNull().default(1),
  /** Zero-pad width for the running number in project codes. */
  projectPadWidth: integer("project_pad_width").notNull().default(3),
  ...timestamps,
})

export const quotationTemplates = pgTable("quotation_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** Tenant-scoped template code used in account/settings selection. */
  code: text("code").notNull(),
  /** Label shown in admin UI. */
  label: text("label").notNull(),
  /** Notes for operators/admins; optional. */
  notes: text("notes"),
  /**
   * Built-in renderer binding. Set to `default`, `qar`, `cc` for existing
   * React components, or another value when a custom HTML template is used.
   */
  legacyTemplateCode: text("legacy_template_code"),
  /** Render strategy for this template (`builtin` or `html`). */
  renderMode: text("render_mode").notNull().default("builtin"),
  /** Raw HTML template body for custom renderer mode. */
  htmlTemplate: text("html_template"),
  /** Custom CSS scoped to this template for renderer mode `html`. */
  cssTemplate: text("css_template"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}, (t) => [unique("quotation_templates_org_code_uq").on(t.organizationId, t.code)])

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
 * An invitation for someone who has NOT signed in yet. `addMember` handles
 * users who already exist; this covers the rest: an admin invites by email,
 * and the auth user-creation hook consumes the invite on first sign-in,
 * creating the member + profile with the invited role/tier. Exact-email
 * invites take precedence over domain auto-join.
 */
export const pendingInvites = pgTable(
  "pending_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),
    tierLevel: integer("tier_level").notNull().default(0),
    invitedByMemberId: text("invited_by_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("pending_invites_email_uq").on(
      t.tenantId,
      t.normalizedEmail
    ),
  ]
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

/**
 * A member's roles (many-to-many). Effective permissions = the UNION of every
 * assigned role's grants — a person can hold several roles for different areas
 * (e.g. "Sales Rep" + "Quotation Approver"). membership_profiles keeps the
 * lifecycle (status) + reporting line; membership_profiles.role_id is the
 * legacy "primary" role kept in sync with the first assignment for display.
 */
export const memberRoles = pgTable(
  "member_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [unique("member_roles_uq").on(t.memberId, t.roleId)]
)
