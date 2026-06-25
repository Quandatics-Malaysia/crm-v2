import { eq } from "drizzle-orm"
import { runInTenant } from "@/db"
import { attachments } from "@/db/schema"
import { getServerContext } from "@/lib/server-context"
import { storage } from "@/lib/storage"

/** Authenticated, tenant-scoped download of an attachment's bytes. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getServerContext()
  if (!ctx || !ctx.tenantId) {
    return new Response("Forbidden", { status: 403 })
  }

  const { id } = await params

  const row = await runInTenant(ctx.tenantId, async (tx) => {
    const [r] = await tx
      .select({
        fileName: attachments.fileName,
        contentType: attachments.contentType,
        storageKey: attachments.storageKey,
      })
      .from(attachments)
      .where(eq(attachments.id, id))
      .limit(1)
    return r ?? null
  })

  if (!row) {
    return new Response("Not found", { status: 404 })
  }

  let bytes: Buffer
  try {
    bytes = await storage.get(row.storageKey)
  } catch {
    return new Response("Not found", { status: 404 })
  }

  const safeName = row.fileName.replace(/["\\\r\n]/g, "_")
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": row.contentType || "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${safeName}"`,
    },
  })
}
