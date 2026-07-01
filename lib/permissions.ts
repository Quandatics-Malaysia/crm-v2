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
  // products (standardised catalog)
  PRODUCT_VIEW: "product.view",
  PRODUCT_CREATE: "product.create",
  PRODUCT_UPDATE: "product.update",
  PRODUCT_DELETE: "product.delete",
  // projects
  PROJECT_VIEW: "project.view",
  PROJECT_CREATE: "project.create",
  PROJECT_UPDATE: "project.update",
  PROJECT_DELETE: "project.delete",
  // sales orders
  SALES_ORDER_VIEW: "sales_order.view",
  SALES_ORDER_SUBMIT: "sales_order.submit",
  SALES_ORDER_APPROVE: "sales_order.approve",
  // reporting
  FORECAST_VIEW: "forecast.view",
  // tenant administration
  TENANT_MANAGE_USERS: "tenant.manage_users",
  TENANT_MANAGE_ROLES: "tenant.manage_roles",
  TENANT_SETTINGS: "tenant.settings",
  AUDIT_VIEW: "audit.view",
  // record-level access — elevations that bypass owner + managed-subtree scoping
  RECORDS_VIEW_ALL: "records.view_all",
  RECORDS_MANAGE_ALL: "records.manage_all",
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
  PERMISSIONS.PRODUCT_VIEW,
  PERMISSIONS.PROJECT_VIEW,
  PERMISSIONS.SALES_ORDER_VIEW,
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
  PERMISSIONS.SALES_ORDER_SUBMIT,
]

const MANAGER: PermissionKey[] = [
  ...REP_BASE,
  PERMISSIONS.SALES_ORDER_APPROVE,
  PERMISSIONS.LEAD_DELETE,
  PERMISSIONS.ACCOUNT_DELETE,
  PERMISSIONS.PERSON_DELETE,
  PERMISSIONS.OPPORTUNITY_DELETE,
  PERMISSIONS.PROJECT_DELETE,
  PERMISSIONS.PRODUCT_CREATE,
  PERMISSIONS.PRODUCT_UPDATE,
  PERMISSIONS.PRODUCT_DELETE,
  PERMISSIONS.STAGE_ADVANCE_APPROVE,
  PERMISSIONS.QUOTATION_SEND,
  PERMISSIONS.QUOTATION_ACCEPT,
  PERMISSIONS.QUOTATION_DELETE,
  PERMISSIONS.TAX_CONFIGURE,
  PERMISSIONS.FUNNEL_MANAGE,
  PERMISSIONS.AUDIT_VIEW,
]

/** Grouped, human-labeled catalog for the role permission-matrix UI. */
export const PERMISSION_GROUPS: {
  group: string
  items: { key: PermissionKey; label: string }[]
}[] = [
  {
    group: "Leads",
    items: [
      { key: PERMISSIONS.LEAD_VIEW, label: "View leads" },
      { key: PERMISSIONS.LEAD_CREATE, label: "Create leads" },
      { key: PERMISSIONS.LEAD_UPDATE, label: "Edit leads" },
      { key: PERMISSIONS.LEAD_DELETE, label: "Delete leads" },
      { key: PERMISSIONS.LEAD_CONVERT, label: "Convert leads" },
    ],
  },
  {
    group: "Accounts",
    items: [
      { key: PERMISSIONS.ACCOUNT_VIEW, label: "View accounts" },
      { key: PERMISSIONS.ACCOUNT_CREATE, label: "Create accounts" },
      { key: PERMISSIONS.ACCOUNT_UPDATE, label: "Edit accounts" },
      { key: PERMISSIONS.ACCOUNT_DELETE, label: "Delete accounts" },
    ],
  },
  {
    group: "Contacts",
    items: [
      { key: PERMISSIONS.PERSON_VIEW, label: "View contacts" },
      { key: PERMISSIONS.PERSON_CREATE, label: "Create contacts" },
      { key: PERMISSIONS.PERSON_UPDATE, label: "Edit contacts" },
      { key: PERMISSIONS.PERSON_DELETE, label: "Delete contacts" },
    ],
  },
  {
    group: "Funnel",
    items: [
      { key: PERMISSIONS.OPPORTUNITY_VIEW, label: "View funnels" },
      { key: PERMISSIONS.OPPORTUNITY_CREATE, label: "Create funnels" },
      { key: PERMISSIONS.OPPORTUNITY_UPDATE, label: "Edit funnels" },
      { key: PERMISSIONS.OPPORTUNITY_DELETE, label: "Delete funnels" },
      { key: PERMISSIONS.STAGE_ADVANCE, label: "Advance stages" },
      { key: PERMISSIONS.STAGE_ADVANCE_APPROVE, label: "Approve stage advances" },
      { key: PERMISSIONS.FUNNEL_MANAGE, label: "Manage funnels & stages" },
    ],
  },
  {
    group: "Quotations & Tax",
    items: [
      { key: PERMISSIONS.QUOTATION_VIEW, label: "View quotations" },
      { key: PERMISSIONS.QUOTATION_CREATE, label: "Create quotations" },
      { key: PERMISSIONS.QUOTATION_UPDATE, label: "Edit quotations" },
      { key: PERMISSIONS.QUOTATION_DELETE, label: "Delete quotations" },
      { key: PERMISSIONS.QUOTATION_SEND, label: "Send quotations" },
      { key: PERMISSIONS.QUOTATION_ACCEPT, label: "Accept quotations" },
      { key: PERMISSIONS.TAX_VIEW, label: "View tax settings" },
      { key: PERMISSIONS.TAX_CONFIGURE, label: "Configure tax" },
    ],
  },
  {
    group: "Products",
    items: [
      { key: PERMISSIONS.PRODUCT_VIEW, label: "View products" },
      { key: PERMISSIONS.PRODUCT_CREATE, label: "Create products" },
      { key: PERMISSIONS.PRODUCT_UPDATE, label: "Edit products" },
      { key: PERMISSIONS.PRODUCT_DELETE, label: "Delete products" },
    ],
  },
  {
    group: "Projects",
    items: [
      { key: PERMISSIONS.PROJECT_VIEW, label: "View projects" },
      { key: PERMISSIONS.PROJECT_CREATE, label: "Create projects" },
      { key: PERMISSIONS.PROJECT_UPDATE, label: "Edit projects" },
      { key: PERMISSIONS.PROJECT_DELETE, label: "Delete projects" },
    ],
  },
  {
    group: "Sales Orders",
    items: [
      { key: PERMISSIONS.SALES_ORDER_VIEW, label: "View sales orders" },
      { key: PERMISSIONS.SALES_ORDER_SUBMIT, label: "Submit sales orders" },
      { key: PERMISSIONS.SALES_ORDER_APPROVE, label: "Approve / reject sales orders" },
    ],
  },
  {
    group: "Reporting",
    items: [
      { key: PERMISSIONS.FORECAST_VIEW, label: "View forecast" },
      { key: PERMISSIONS.AUDIT_VIEW, label: "View audit log" },
    ],
  },
  {
    group: "Record access",
    items: [
      {
        key: PERMISSIONS.RECORDS_VIEW_ALL,
        label: "View all records (bypass ownership)",
      },
      {
        key: PERMISSIONS.RECORDS_MANAGE_ALL,
        label: "Edit/delete any record (bypass ownership)",
      },
    ],
  },
  {
    group: "Administration",
    items: [
      { key: PERMISSIONS.TENANT_MANAGE_USERS, label: "Manage users" },
      { key: PERMISSIONS.TENANT_MANAGE_ROLES, label: "Manage roles" },
      { key: PERMISSIONS.TENANT_SETTINGS, label: "Manage settings" },
    ],
  },
]

export type RoleTemplate = {
  name: string
  description: string
  tier: number
  permissions: PermissionKey[] | "*"
}

/** Seeded once per tenant. Tier drives the "low tier needs approval" gate. */
export const ROLE_TEMPLATES: RoleTemplate[] = [
  { name: "Owner", description: "Full control of the workspace", tier: 100, permissions: "*" },
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
  {
    name: "Viewer",
    description: "Read-only access across the whole workspace",
    tier: 10,
    permissions: [...VIEW_ONLY, PERMISSIONS.RECORDS_VIEW_ALL],
  },
]
