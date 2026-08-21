import { and, eq, isNull } from "drizzle-orm"
import { NextResponse } from "next/server"
import { visibleMemberIds, ownsOrManages, canManageAllRecords } from "@/lib/access-scope"
import { corsHeaders, preflight } from "@/lib/api-cors"
import { getApiContext, withApiTenant } from "@/lib/api-auth"
import { PERMISSIONS } from "@/lib/permissions"
import { type Tx } from "@/db"
import {
  getQuotationTemplateByCode,
  quotationTemplateAssignInputSchema,
  toNormalizedTemplateCode,
} from "@/lib/quotation-template-api"
import { accounts } from "@/db/schema"

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

async function getAccountOwnerContext(tx: Tx, accountId: string) {
  const [account] = await tx
    .select({ id: accounts.id, ownerMemberId: accounts.ownerMemberId })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
    .limit(1)
  return account ?? null
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getApiContext(req)
  if (!ctx) return err("unauthorized", "Missing or invalid API key", 401, req)

  const { id } = await params

  try {
    const row = await withApiTenant(ctx, PERMISSIONS.ACCOUNT_UPDATE, async (tx) => {
      const [account] = await tx
        .select({
          id: accounts.id,
          ownerMemberId: accounts.ownerMemberId,
          quotationTemplateCode: accounts.quotationTemplateCode,
        })
        .from(accounts)
        .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
        .limit(1)

      if (!account) return null

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, account.ownerMemberId)) {
        return null
      }

      return account
    })

    if (!row) return err("not_found", "Account not found", 404, req)
    return withPayload({ data: { accountId: row.id, quotationTemplateCode: row.quotationTemplateCode ?? null } }, req)
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("FORBIDDEN")) {
      return err("forbidden", "Your API key's role lacks permission for this resource", 403, req)
    }
    console.error("api/v1 accounts [id] quotation-template GET error", e)
    return err("internal_error", "Internal error", 500, req)
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getApiContext(req)
  if (!ctx) return err("unauthorized", "Missing or invalid API key", 401, req)

  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = quotationTemplateAssignInputSchema.safeParse(body)
  if (!parsed.success) {
    return err("validation", "Invalid request payload", 400, req)
  }

  try {
    const nextTemplateCode = toNormalizedTemplateCode(parsed.data.quotationTemplateCode)

    if (nextTemplateCode) {
      const template = await withApiTenant(ctx, PERMISSIONS.ACCOUNT_UPDATE, (tx) =>
        getQuotationTemplateByCode(tx, ctx.tenantId, nextTemplateCode)
      )
      if (!template || !template.isActive) {
        return err("validation", "Selected quotation template is not active", 400, req)
      }
    }

    const updated = await withApiTenant(ctx, PERMISSIONS.ACCOUNT_UPDATE, async (tx) => {
      const account = await getAccountOwnerContext(tx, id)
      if (!account) return null

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, account.ownerMemberId)) {
        return null
      }

      const [row] = await tx
        .update(accounts)
        .set({
          quotationTemplateCode: nextTemplateCode,
          updatedAt: new Date(),
        })
        .where(and(eq(accounts.id, id), eq(accounts.tenantId, ctx.tenantId), isNull(accounts.deletedAt)))
        .returning({ id: accounts.id, quotationTemplateCode: accounts.quotationTemplateCode })

      return row ?? null
    })

    if (!updated) return err("not_found", "Account not found", 404, req)
    return withPayload(
      { data: { accountId: updated.id, quotationTemplateCode: updated.quotationTemplateCode } },
      req
    )
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("FORBIDDEN")) {
      return err("forbidden", "Your API key's role lacks permission for this resource", 403, req)
    }
    console.error("api/v1 accounts [id] quotation-template PATCH error", e)
    return err("internal_error", "Internal error", 500, req)
  }
}

export const OPTIONS = (req: Request) => preflight(req)
