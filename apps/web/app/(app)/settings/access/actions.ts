"use server"

import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant } from "@/lib/actions"
import { type ActionResult, runAction } from "@/lib/action-result"
import { PERMISSIONS } from "@/lib/permissions"
import { apiKeys } from "@/db/schema"
import { generateApiKey } from "@/lib/api-auth"
import { writeAudit } from "@/server/audit"

/**
 * Non-secret view of an `api_keys` row. `keyHash` is never selected here —
 * the raw key is only ever returned once, from {@link createApiKey}.
 */
export type ApiKeyRow = {
  id: string
  name: string
  keyPrefix: string
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

/** All API keys for the tenant, newest first. Never selects `keyHash`. */
export async function listApiKeys(): Promise<ApiKeyRow[]> {
  return withTenant(PERMISSIONS.TENANT_SETTINGS, (tx, ctx) =>
    tx
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.organizationId, ctx.tenantId))
      .orderBy(desc(apiKeys.createdAt))
  )
}

/**
 * Mint a new API key for the current tenant, acting as the current member.
 * The full key is returned ONLY in this response — the client must show it
 * once (a "copy it now" dialog) and never re-fetch it; only the sha256 hash
 * is persisted.
 */
export async function createApiKey(
  name: string
): Promise<ActionResult<{ id: string; fullKey: string }>> {
  return runAction(async () => {
    const trimmed = name.trim()
    if (!trimmed) throw new Error("Name is required")

    const result = await withTenant(
      PERMISSIONS.TENANT_SETTINGS,
      async (tx, ctx) => {
        // A key acts as a specific member (api-auth.ts resolves it back to one),
        // so it can only be minted by someone with an actual membership — not a
        // superadmin browsing without one.
        if (!ctx.memberId) throw new Error("No active membership for this tenant")
        const { key, prefix, hash } = generateApiKey()
        const [created] = await tx
          .insert(apiKeys)
          .values({
            organizationId: ctx.tenantId,
            memberId: ctx.memberId,
            name: trimmed,
            keyPrefix: prefix,
            keyHash: hash,
            // `created_by` FKs to `user.id` (the auth identity), not `member.id`.
            createdBy: ctx.userId,
          })
          .returning({ id: apiKeys.id })
        await writeAudit(tx, ctx, {
          action: "api_key.created",
          entityType: "api_key",
          entityId: created.id,
          after: { name: trimmed, keyPrefix: prefix },
        })
        return { id: created.id, fullKey: key }
      }
    )
    revalidatePath("/settings/access")
    return result
  })
}

/**
 * Revoke a key by setting `revokedAt`. Scoped to id AND the current tenant
 * (belt-and-suspenders on top of RLS) so one tenant can never revoke another
 * tenant's key even if it guesses an id.
 */
export async function revokeApiKey(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.TENANT_SETTINGS, async (tx, ctx) => {
      const [updated] = await tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, ctx.tenantId)))
        .returning({ id: apiKeys.id })
      if (!updated) throw new Error("API key not found")
      await writeAudit(tx, ctx, {
        action: "api_key.revoked",
        entityType: "api_key",
        entityId: id,
      })
    })
    revalidatePath("/settings/access")
  })
}
