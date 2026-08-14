import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { corsHeaders, preflight } from "@/lib/api-cors"
import { getApiContext, withApiTenant } from "@/lib/api-auth"
import { PERMISSIONS } from "@/lib/permissions"
import {
  getQuotationTemplateByCode,
  quotationTemplatePatchSchema,
  toNormalizedTemplateCode,
} from "@/lib/quotation-template-api"
import { quotationTemplates } from "@/db/schema"

export const dynamic = "force-dynamic"

function err(code: string, message: string, status: number, req: Request) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: corsHeaders(req) }
  )
}

function withPayload(data: unknown, req: Request) {
  return NextResponse.json(data, { headers: corsHeaders(req) })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const ctx = await getApiContext(req)
  if (!ctx) return err("unauthorized", "Missing or invalid API key", 401, req)

  const { code } = await params
  const normalized = toNormalizedTemplateCode(code)
  if (!normalized) {
    return err("validation", "Invalid quotation template code", 400, req)
  }

  try {
    const row = await withApiTenant(ctx, PERMISSIONS.TENANT_SETTINGS, (tx) =>
      getQuotationTemplateByCode(tx, ctx.tenantId, normalized)
    )
    if (!row) return err("not_found", "Template not found", 404, req)
    return withPayload({ data: row }, req)
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("FORBIDDEN")) {
      return err("forbidden", "Your API key's role lacks permission for this resource", 403, req)
    }
    console.error("api/v1 quotation-templates GET error", e)
    return err("internal", "Internal error", 500, req)
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const ctx = await getApiContext(req)
  if (!ctx) return err("unauthorized", "Missing or invalid API key", 401, req)

  const { code } = await params
  const normalized = toNormalizedTemplateCode(code)
  if (!normalized) {
    return err("validation", "Invalid quotation template code", 400, req)
  }

  const body = await req.json().catch(() => null)
  const parsed = quotationTemplatePatchSchema.safeParse(body)
  if (!parsed.success) {
    return err("validation", "Invalid request payload", 400, req)
  }

  const payload = parsed.data
  if (Object.keys(payload).length === 0) {
    return err("validation", "No fields to update", 400, req)
  }

  try {
    const updated = await withApiTenant(ctx, PERMISSIONS.TENANT_SETTINGS, async (tx) => {
      const existing = await getQuotationTemplateByCode(tx, ctx.tenantId, normalized)
      if (!existing) return null

      const nextRenderMode = (payload.renderMode ?? existing.renderMode) as
        | "builtin"
        | "html"
      const nextHtmlTemplate = payload.htmlTemplate ?? existing.htmlTemplate ?? null

      if (nextRenderMode === "html" && nextHtmlTemplate == null) {
        throw new Error("renderMode html requires htmlTemplate")
      }

      const values = {
        label: payload.label ?? existing.label,
        legacyTemplateCode:
          payload.legacyTemplateCode === undefined
            ? existing.legacyTemplateCode
            : payload.legacyTemplateCode,
        renderMode: payload.renderMode ?? existing.renderMode,
        htmlTemplate:
          payload.htmlTemplate === undefined
            ? existing.htmlTemplate
            : payload.htmlTemplate,
        cssTemplate:
          payload.cssTemplate === undefined
            ? existing.cssTemplate
            : payload.cssTemplate,
        notes: payload.notes === undefined ? existing.notes : payload.notes,
        isActive:
          payload.isActive === undefined ? existing.isActive : payload.isActive,
      }

      const [updated] = await tx
        .update(quotationTemplates)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(quotationTemplates.organizationId, ctx.tenantId),
            eq(quotationTemplates.code, normalized)
          )
        )
        .returning()

      return updated
    })

    if (!updated) return err("not_found", "Template not found", 404, req)
    return withPayload({ data: updated }, req)
  } catch (e) {
    if (e instanceof Error) {
      if (e.message.startsWith("renderMode")) {
        return err("validation", e.message, 400, req)
      }
      if (e.message.startsWith("FORBIDDEN")) {
        return err("forbidden", "Your API key's role lacks permission for this resource", 403, req)
      }
    }
    console.error("api/v1 quotation-templates PATCH error", e)
    return err("internal", "Internal error", 500, req)
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const ctx = await getApiContext(req)
  if (!ctx) return err("unauthorized", "Missing or invalid API key", 401, req)

  const { code } = await params
  const normalized = toNormalizedTemplateCode(code)
  if (!normalized) {
    return err("validation", "Invalid quotation template code", 400, req)
  }

  try {
    const template = await withApiTenant(ctx, PERMISSIONS.TENANT_SETTINGS, async (tx) => {
      const [row] = await tx
        .update(quotationTemplates)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(quotationTemplates.organizationId, ctx.tenantId),
            eq(quotationTemplates.code, normalized),
            eq(quotationTemplates.isActive, true)
          )
        )
        .returning()
      return row ?? null
    })

    if (!template) return err("not_found", "Template not found", 404, req)
    return withPayload({ data: template }, req)
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("FORBIDDEN")) {
      return err("forbidden", "Your API key's role lacks permission for this resource", 403, req)
    }
    console.error("api/v1 quotation-templates DELETE error", e)
    return err("internal", "Internal error", 500, req)
  }
}

export const OPTIONS = (req: Request) => preflight(req)
