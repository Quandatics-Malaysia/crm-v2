import { NextResponse } from "next/server"
import { getApiContext, withApiTenant } from "@/lib/api-auth"
import { API_RESOURCES } from "@/lib/api-readers"
import { corsHeaders, preflight } from "@/lib/api-cors"
import { ModuleAccessDeniedError } from "@/lib/modules.server"
import { withApiResourceEntitlement } from "@/lib/api-module-guard"

export const dynamic = "force-dynamic"

function err(code: string, message: string, status: number, req: Request) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: corsHeaders(req) }
  )
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ resource: string; id: string }> }
) {
  // Authenticate first (avoid resource-name enumeration via 404-vs-401).
  const ctx = await getApiContext(req)
  if (!ctx) return err("unauthorized", "Missing or invalid API key", 401, req)

  const { resource, id } = await params
  const def = API_RESOURCES[resource]
  if (!def) return err("not_found", `Unknown resource '${resource}'`, 404, req)

  try {
    const row = await withApiResourceEntitlement(def, () =>
      withApiTenant(ctx, def.permission, (tx, c) => def.get(tx, c, id))
    )
    if (row === null) return err("not_found", `${resource} '${id}' not found`, 404, req)
    return NextResponse.json({ data: row }, { headers: corsHeaders(req) })
  } catch (e) {
    if (e instanceof ModuleAccessDeniedError) {
      return err("module_unavailable", "This resource is not licensed", 403, req)
    }
    if (e instanceof Error && e.message.startsWith("FORBIDDEN")) {
      return err(
        "forbidden",
        "Your API key's role lacks permission for this resource",
        403,
        req
      )
    }
    console.error("api/v1 error", e)
    return err("internal_error", "Internal error", 500, req)
  }
}

export const OPTIONS = (req: Request) => preflight(req)
