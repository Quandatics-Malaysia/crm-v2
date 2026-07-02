import { eq } from "drizzle-orm"
import { runInTenant } from "@/db"
import { tenantSettings } from "@/db/schema"
import { getServerContext } from "@/lib/server-context"
import { storage } from "@/lib/storage"

/**
 * The active tenant's company logo (uploaded in Settings → General; rendered
 * on quotation documents). Authenticated + tenant-scoped: a member only ever
 * sees their OWN entity's logo, so there is nothing to authorize beyond a
 * valid session with an active tenant.
 */
export async function GET() {
  const ctx = await getServerContext()
  if (!ctx || !ctx.tenantId) {
    return new Response("Forbidden", { status: 403 })
  }

  const row = await runInTenant(ctx.tenantId, async (tx) => {
    const [r] = await tx
      .select({
        key: tenantSettings.logoStorageKey,
        contentType: tenantSettings.logoContentType,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    return r ?? null
  })
  if (!row?.key) return new Response("Not found", { status: 404 })

  let bytes: Buffer
  try {
    bytes = await storage.get(row.key)
  } catch {
    return new Response("Not found", { status: 404 })
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": row.contentType || "image/png",
      "Content-Length": String(bytes.byteLength),
      // The key changes on every upload, so short private caching is safe.
      "Cache-Control": "private, max-age=300",
    },
  })
}
