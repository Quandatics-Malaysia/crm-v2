import { eq } from "drizzle-orm"
import { runInTenant } from "@/db"
import { attachments } from "@/db/schema"
import { getServerContext } from "@/lib/server-context"
import {
  canAccessAttachable,
  requireAttachableEntitlement,
} from "@/lib/access-scope"
import {
  ATTACH_PERMS,
  type AttachableType,
} from "@/app/(app)/_shared/attachment-perms"
import { storage } from "@/lib/storage"

/** Authenticated, tenant-scoped attachment bytes. Inline by default (so PDFs/
 *  images render in the browser); add ?dl=1 to force a download. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getServerContext()
  if (!ctx || !ctx.tenantId) {
    return new Response("Forbidden", { status: 403 })
  }

  const { id } = await params

  const result = await runInTenant(ctx.tenantId, async (tx) => {
    const [r] = await tx
      .select({
        fileName: attachments.fileName,
        contentType: attachments.contentType,
        storageKey: attachments.storageKey,
        attachableType: attachments.attachableType,
        attachableId: attachments.attachableId,
      })
      .from(attachments)
      .where(eq(attachments.id, id))
      .limit(1)
    if (!r) return { row: null, allowed: false }
    const type = r.attachableType as AttachableType
    try {
      await requireAttachableEntitlement(type)
    } catch {
      return { row: r, allowed: false }
    }
    // Authorize by capability AND the parent record's ownership (own/subtree/
    // elevation), matching the attachment actions — not the capability alone.
    const perm = ATTACH_PERMS[type]?.view
    const allowed =
      !!perm &&
      ctx.can(perm) &&
      (await canAccessAttachable(tx, ctx, type, r.attachableId, "view"))
    return { row: r, allowed }
  })

  if (!result.row) {
    return new Response("Not found", { status: 404 })
  }
  if (!result.allowed) {
    return new Response("Forbidden", { status: 403 })
  }
  const row = result.row

  let bytes: Buffer
  try {
    bytes = await storage.get(row.storageKey)
  } catch {
    return new Response("Not found", { status: 404 })
  }

  const safeName = row.fileName.replace(/["\\\r\n]/g, "_")
  const download = new URL(req.url).searchParams.has("dl")
  const disposition = download ? "attachment" : "inline"
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": row.contentType || "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${disposition}; filename="${safeName}"`,
    },
  })
}
