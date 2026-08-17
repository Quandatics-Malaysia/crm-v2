import { eq } from "drizzle-orm"

import type { Tx } from "@/db"
import { organization } from "@/db/schema"

/**
 * Shared transaction boundary for product taxonomy settings and product
 * references. The organization row always exists for an authenticated tenant,
 * so this also serializes the first settings upsert when tenant_settings has no
 * row yet.
 */
export async function lockProductTaxonomy(
  tx: Tx,
  tenantId: string
): Promise<void> {
  const [tenant] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, tenantId))
    .for("update")
    .limit(1)

  if (!tenant) throw new Error("Tenant not found")
}
