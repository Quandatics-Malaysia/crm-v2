/**
 * Build-composition ceiling only. Commercial access always comes from the
 * verified signed runtime entitlement. A `true` value compiles capability into
 * the image but never grants access; `false` intentionally omits capability.
 * Standard production image compiles all seven optional modules.
 *
 * This file is PURE — no imports, no side effects — so it is safe to import
 * from client components, server components, server actions, next-free
 * services, and the DB seed scripts alike.
 */
export const MODULE_CONFIG = {
  /** Delivery projects (Release 3). Payment Milestones is a core feature and
   *  is NOT gated by this flag — it lives directly under a Funnel and has no
   *  Project dependency (see components/app-sidebar.tsx). */
  projects: true,
  /** Sales orders: accepted-quote → SO, per-tenant numbering, approval (Release 2). */
  salesOrders: true,
  /** Billing + Purchasing (O2C/P2P finance_docs) + intercompany billing (Release 6). */
  finance: true,
  /** Probability-weighted billing forecast + executive reporting (Release 4). */
  forecast: true,
  /** Audit trail & compliance-log VIEWER (the log is always recorded; this only
   *  gates the /audit reporting surface). Deferred in the Core Edition. */
  audit: true,
  /** Advanced roles: custom roles, the granular per-module permission matrix
   *  editor, and seniority-tier editing. OFF = fixed preset roles + basic role
   *  assignment + simple reporting line (the permission ENGINE always runs).
   *  Deferred in the Core Edition (PROP-0003 "Advanced roles" expansion). */
  advancedRoles: true,
  /** In-app documentation site. */
  documentation: true,
} as const
