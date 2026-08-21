import { NextResponse } from "next/server"
import { getApiContext, withApiTenant } from "@/lib/api-auth"
import { PERMISSIONS } from "@/lib/permissions"
import { corsHeaders, preflight } from "@/lib/api-cors"
import { quotationTemplateCreateSchema, listQuotationTemplates, toNormalizedTemplateCode, getQuotationTemplateByCode } from "@/lib/quotation-template-api"
import { quotationTemplates } from "@/db/schema"

export const dynamic = "force-dynamic"

function err(code: string, message: string, status: number, req: Request) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: corsHeaders(req) }
  )
}

function withTemplatePayload<T>(payload: T, req: Request, status = 200) {
  return NextResponse.json(payload, { status, headers: corsHeaders(req) })
}

export async function GET(req: Request) {
  const ctx = await getApiContext(req)
  if (!ctx) return err("unauthorized", "Missing or invalid API key", 401, req)

  try {
    const rows = await withApiTenant(ctx, PERMISSIONS.TENANT_SETTINGS, (tx) =>
      listQuotationTemplates(tx, ctx.tenantId)
    )
    return withTemplatePayload({ data: rows }, req)
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("FORBIDDEN")) {
      return err("forbidden", "Your API key's role lacks permission for this resource", 403, req)
    }
    console.error("api/v1 quotation-templates GET error", e)
    return err("internal_error", "Internal error", 500, req)
  }
}

export async function POST(req: Request) {
  const ctx = await getApiContext(req)
  if (!ctx) return err("unauthorized", "Missing or invalid API key", 401, req)

  const body = await req.json().catch(() => null)
  const parsed = quotationTemplateCreateSchema.safeParse(body)
  if (!parsed.success) {
    return err("validation", "Invalid request payload", 400, req)
  }

  try {
    const template = parsed.data
    const code = toNormalizedTemplateCode(template.code)
    if (!code) return err("validation", "Invalid quotation template code", 400, req)

    const result = await withApiTenant(ctx, PERMISSIONS.TENANT_SETTINGS, (tx) =>
      (async () => {
        const existing = await getQuotationTemplateByCode(tx, ctx.tenantId, code)
        if (existing) {
          return {
            ok: false as const,
            reason: "duplicate",
            message: `Template code '${code}' already exists`,
          }
        }

        const created = await tx
          .insert(quotationTemplates)
          .values({
            organizationId: ctx.tenantId,
            code,
            label: template.label,
            legacyTemplateCode: template.legacyTemplateCode,
            renderMode: template.renderMode,
            htmlTemplate: template.htmlTemplate ?? null,
            cssTemplate: template.cssTemplate ?? null,
            notes: template.notes ?? null,
            isActive: template.isActive,
          })
          .returning()
        return { ok: true as const, data: created[0] }
      })()
    )

    if (!result.ok) {
      return err("conflict", result.message, 409, req)
    }

    return withTemplatePayload(
      { data: result.data },
      req,
      201
    )
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("FORBIDDEN")) {
      return err("forbidden", "Your API key's role lacks permission for this resource", 403, req)
    }
    console.error("api/v1 quotation-templates POST error", e)
    return err("internal_error", "Internal error", 500, req)
  }
}

export const OPTIONS = (req: Request) => preflight(req)
