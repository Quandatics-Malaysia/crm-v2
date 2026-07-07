/**
 * Global plugin switches — the single source of truth for which optional
 * modules are live. ONE boolean per plugin, for the whole deployment (NOT
 * per-tenant). Flip a value and rebuild/redeploy to enable or disable a plugin.
 *
 * The MVP (PROP-0003, Release 1) ships with all four business plugins OFF —
 * only the core CRM (leads, accounts, contacts, opportunities, funnel with
 * stage-gated approvals, quotations, tax, products, pipeline dashboard, roles)
 * is enabled. Later releases turn a feature on here.
 *
 * Dependencies between plugins are validated at boot (see lib/modules.ts →
 * validateModuleConfig, called from instrumentation.ts): e.g. `finance`
 * requires `projects` and `salesOrders`.
 *
 * This file is PURE — no imports, no side effects — so it is safe to import
 * from client components, server components, server actions, next-free
 * services, and the DB seed scripts alike.
 */
export const MODULE_CONFIG = {
  /** Delivery projects + payment milestones (Release 3). */
  projects: false,
  /** Sales orders: accepted-quote → SO, per-tenant numbering, approval (Release 2). */
  salesOrders: false,
  /** Billing + Purchasing (O2C/P2P finance_docs) + intercompany billing (Release 6). */
  finance: false,
  /** Probability-weighted billing forecast + executive reporting (Release 4). */
  forecast: false,
  /** Audit trail & compliance-log VIEWER (the log is always recorded; this only
   *  gates the /audit reporting surface). Deferred in the Core Edition. */
  audit: false,
  /** Advanced roles: custom roles, the granular per-module permission matrix
   *  editor, and seniority-tier editing. OFF = fixed preset roles + basic role
   *  assignment + simple reporting line (the permission ENGINE always runs).
   *  Deferred in the Core Edition (PROP-0003 "Advanced roles" expansion). */
  advancedRoles: false,
  /** In-app documentation site. Kept on by default. */
  documentation: true,
} as const
