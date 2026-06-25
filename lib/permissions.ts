/**
 * Global capability catalog + system role templates.
 * Permission keys are software-defined (`resource.action`); roles compose them.
 * This file is the single source of truth seeded into `permissions`,
 * `roles`, and `role_permissions` per tenant.
 */

export const PERMISSIONS = {
  // leads
  LEAD_VIEW: "lead.view",
  LEAD_CREATE: "lead.create",
  LEAD_UPDATE: "lead.update",
  LEAD_DELETE: "lead.delete",
  LEAD_CONVERT: "lead.convert",
  // accounts
  ACCOUNT_VIEW: "account.view",
  ACCOUNT_CREATE: "account.create",
  ACCOUNT_UPDATE: "account.update",
  ACCOUNT_DELETE: "account.delete",
  // persons
  PERSON_VIEW: "person.view",
  PERSON_CREATE: "person.create",
  PERSON_UPDATE: "person.update",
  PERSON_DELETE: "person.delete",
  // opportunities + pipeline
  OPPORTUNITY_VIEW: "opportunity.view",
  OPPORTUNITY_CREATE: "opportunity.create",
  OPPORTUNITY_UPDATE: "opportunity.update",
  OPPORTUNITY_DELETE: "opportunity.delete",
  STAGE_ADVANCE: "stage.advance",
  STAGE_ADVANCE_APPROVE: "stage.advance.approve",
  FUNNEL_MANAGE: "funnel.manage",
  // quotations + tax
  QUOTATION_VIEW: "quotation.view",
  QUOTATION_CREATE: "quotation.create",
  QUOTATION_UPDATE: "quotation.update",
  QUOTATION_DELETE: "quotation.delete",
  QUOTATION_SEND: "quotation.send",
  QUOTATION_ACCEPT: "quotation.accept",
  TAX_VIEW: "tax.view",
  TAX_CONFIGURE: "tax.configure",
  // projects
  PROJECT_VIEW: "project.view",
  PROJECT_CREATE: "project.create",
  PROJECT_UPDATE: "project.update",
  PROJECT_DELETE: "project.delete",
  // reporting
  FORECAST_VIEW: "forecast.view",
  // tenant administration
  TENANT_MANAGE_USERS: "tenant.manage_users",
  TENANT_MANAGE_ROLES: "tenant.manage_roles",
  TENANT_SETTINGS: "tenant.settings",
  CUSTOM_FIELD_MANAGE: "custom_field.manage",
  AUDIT_VIEW: "audit.view",
} as const

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSION_KEYS: PermissionKey[] = Object.values(PERMISSIONS)

const VIEW_ONLY: PermissionKey[] = [
  PERMISSIONS.LEAD_VIEW,
  PERMISSIONS.ACCOUNT_VIEW,
  PERMISSIONS.PERSON_VIEW,
  PERMISSIONS.OPPORTUNITY_VIEW,
  PERMISSIONS.QUOTATION_VIEW,
  PERMISSIONS.TAX_VIEW,
  PERMISSIONS.FORECAST_VIEW,
  PERMISSIONS.PROJECT_VIEW,
]

const REP_BASE: PermissionKey[] = [
  ...VIEW_ONLY,
  PERMISSIONS.LEAD_CREATE,
  PERMISSIONS.LEAD_UPDATE,
  PERMISSIONS.LEAD_CONVERT,
  PERMISSIONS.ACCOUNT_CREATE,
  PERMISSIONS.ACCOUNT_UPDATE,
  PERMISSIONS.PERSON_CREATE,
  PERMISSIONS.PERSON_UPDATE,
  PERMISSIONS.OPPORTUNITY_CREATE,
  PERMISSIONS.OPPORTUNITY_UPDATE,
  PERMISSIONS.STAGE_ADVANCE,
  PERMISSIONS.QUOTATION_CREATE,
  PERMISSIONS.QUOTATION_UPDATE,
  PERMISSIONS.PROJECT_CREATE,
  PERMISSIONS.PROJECT_UPDATE,
]

const MANAGER: PermissionKey[] = [
  ...REP_BASE,
  PERMISSIONS.LEAD_DELETE,
  PERMISSIONS.ACCOUNT_DELETE,
  PERMISSIONS.PERSON_DELETE,
  PERMISSIONS.OPPORTUNITY_DELETE,
  PERMISSIONS.PROJECT_DELETE,
  PERMISSIONS.STAGE_ADVANCE_APPROVE,
  PERMISSIONS.QUOTATION_SEND,
  PERMISSIONS.QUOTATION_ACCEPT,
  PERMISSIONS.QUOTATION_DELETE,
  PERMISSIONS.TAX_CONFIGURE,
  PERMISSIONS.FUNNEL_MANAGE,
  PERMISSIONS.CUSTOM_FIELD_MANAGE,
  PERMISSIONS.AUDIT_VIEW,
]

export type RoleTemplate = {
  name: string
  description: string
  tier: number
  permissions: PermissionKey[] | "*"
}

/** Seeded once per tenant. Tier drives the "low tier needs approval" gate. */
export const ROLE_TEMPLATES: RoleTemplate[] = [
  { name: "Owner", description: "Full control of the entity", tier: 100, permissions: "*" },
  { name: "Admin", description: "Administer users, roles, and settings", tier: 90, permissions: "*" },
  {
    name: "Manager",
    description: "Manage the team, approve stage advances, send quotes",
    tier: 60,
    permissions: MANAGER,
  },
  {
    name: "Senior Rep",
    description: "Senior salesperson — advances stages without approval",
    tier: 40,
    permissions: [...REP_BASE, PERMISSIONS.QUOTATION_SEND],
  },
  {
    name: "Rep",
    description: "Salesperson — gated stage advances require upline approval",
    tier: 20,
    permissions: REP_BASE,
  },
  { name: "Viewer", description: "Read-only access", tier: 10, permissions: VIEW_ONLY },
]
