/**
 * Add-on module master switches (code-level kill switches).
 *
 * A module is live for a tenant only when BOTH are true:
 *   1. its constant here (flip to false to hide it everywhere, all tenants)
 *   2. the tenant's backend flag (e.g. tenant_settings.finance_module,
 *      enabled per tenant via SQL)
 *
 * Pure constants — safe to import from client and server code.
 */

/** O2C/P2P document chain (Billing + Purchasing). */
export const FINANCE_MODULE = true
