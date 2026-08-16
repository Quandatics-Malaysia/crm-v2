import { NextResponse } from "next/server"
import { corsHeaders, preflight } from "@/lib/api-cors"
import { getApiContext, withApiTenant } from "@/lib/api-auth"
import { PERMISSIONS } from "@/lib/permissions"
import {
  getQuotationTemplateByCodeForUpdate,
  getTenantQuotationTemplateCode,
  quotationTemplateDefaultInputSchema,
  toNormalizedTemplateCode,
  updateTenantQuotationTemplateCode,
} from "@/lib/quotation-template-api"

export const dynamic = "force-dynamic"

function err(code: string, message: string, status: number, req: Request) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: corsHeaders(req) }
  )
}

function withPayload(data: unknown, req: Request) {
  return NextResponse.json({ data }, { headers: corsHeaders(req) })
}

export async function GET(req: Request) {
  const ctx = await getApiContext(req)
  if (!ctx) return err("unauthorized", "Missing or invalid API key", 401, req)

  try {
    const quotationTemplateCode = await withApiTenant(ctx, PERMISSIONS.TENANT_SETTINGS, (tx) =>
      getTenantQuotationTemplateCode(tx, ctx.tenantId)
    )
    return withPayload({ quotationTemplateCode }, req)
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("FORBIDDEN")) {
      return err("forbidden", "Your API key's role lacks permission for this resource", 403, req)
    }
    console.error("api/v1 quotation-templates default GET error", e)
    return err("internal", "Internal error", 500, req)
  }
}

export async function PATCH(req: Request) {
  const ctx = await getApiContext(req)
  if (!ctx) return err("unauthorized", "Missing or invalid API key", 401, req)

  const body = await req.json().catch(() => null)
  const parsed = quotationTemplateDefaultInputSchema.safeParse(body)
  if (!parsed.success) {
    return err("validation", "Invalid request payload", 400, req)
  }

  const quotationTemplateCode = toNormalizedTemplateCode(parsed.data.quotationTemplateCode)

  try {
    const result = await withApiTenant(ctx, PERMISSIONS.TENANT_SETTINGS, async (tx) => {
      if (quotationTemplateCode) {
        const template = await getQuotationTemplateByCodeForUpdate(
          tx,
          ctx.tenantId,
          quotationTemplateCode
        )
        if (!template || !template.isActive) return { ok: false as const }
      }

      const updated = await updateTenantQuotationTemplateCode(
        tx,
        ctx.tenantId,
        quotationTemplateCode
      )
      return { ok: true as const, quotationTemplateCode: updated }
    })

    if (!result.ok) {
      return err("validation", "Selected quotation template is not active", 400, req)
    }
    return withPayload({ quotationTemplateCode: result.quotationTemplateCode }, req)
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("FORBIDDEN")) {
      return err("forbidden", "Your API key's role lacks permission for this resource", 403, req)
    }
    console.error("api/v1 quotation-templates default PATCH error", e)
    return err("internal", "Internal error", 500, req)
  }
}

export const OPTIONS = (req: Request) => preflight(req)
