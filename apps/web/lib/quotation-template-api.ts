import { and, asc, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { type Tx } from "@/db"
import { normalizeQuotationPdfTemplateCode } from "@/lib/quotation-pdf-template"
import {
  accounts,
  quotationTemplates,
  tenantSettings,
} from "@/db/schema"

const MAX_LABEL_LENGTH = 160
const MAX_TEXT_LENGTH = 2000
const MAX_TEMPLATE_LENGTH = 200_000

export type QuotationTemplateRenderMode = "builtin" | "html"

export type QuotationTemplateRow = typeof quotationTemplates.$inferSelect

export const quotationTemplateCreateSchema = z
  .object({
    code: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(MAX_LABEL_LENGTH),
    legacyTemplateCode: z.string().trim().min(1).max(80).nullable().optional(),
    renderMode: z.enum(["builtin", "html"]).default("builtin"),
    htmlTemplate: z.string().max(MAX_TEMPLATE_LENGTH).nullable().optional(),
    cssTemplate: z.string().max(MAX_TEMPLATE_LENGTH).nullable().optional(),
    notes: z.string().trim().max(MAX_TEXT_LENGTH).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.renderMode === "html" && !value.htmlTemplate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["htmlTemplate"],
        message: "htmlTemplate is required when renderMode is html",
      })
    }
  })

export const quotationTemplatePatchSchema = z
  .object({
    label: z.string().trim().min(1).max(MAX_LABEL_LENGTH).optional(),
    legacyTemplateCode: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .nullable()
      .optional(),
    renderMode: z.enum(["builtin", "html"]).optional(),
    htmlTemplate: z.string().max(MAX_TEMPLATE_LENGTH).nullable().optional(),
    cssTemplate: z.string().max(MAX_TEMPLATE_LENGTH).nullable().optional(),
    notes: z.string().trim().max(MAX_TEXT_LENGTH).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.renderMode === "html" && value.htmlTemplate === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["htmlTemplate"],
        message: "htmlTemplate must not be null when renderMode is html",
      })
    }
  })

export const quotationTemplateAssignInputSchema = z.object({
  quotationTemplateCode: z.string().trim().nullable(),
})

export const quotationTemplateDefaultInputSchema = z.object({
  quotationTemplateCode: z.string().trim().nullable(),
})

export const toNormalizedTemplateCode = (value: string | null | undefined): string | null => {
  return normalizeQuotationPdfTemplateCode(value)
}

export async function getQuotationTemplateByCode(
  tx: Tx,
  tenantId: string,
  rawCode: string | null
): Promise<QuotationTemplateRow | null> {
  const code = toNormalizedTemplateCode(rawCode)
  if (!code) return null

  const [template] = await tx
    .select()
    .from(quotationTemplates)
    .where(
      and(
        eq(quotationTemplates.organizationId, tenantId),
        eq(quotationTemplates.code, code)
      )
    )
    .limit(1)

  return template ?? null
}

export async function getQuotationTemplateByCodeForUpdate(
  tx: Tx,
  tenantId: string,
  rawCode: string | null
): Promise<QuotationTemplateRow | null> {
  const code = toNormalizedTemplateCode(rawCode)
  if (!code) return null

  const [template] = await tx
    .select()
    .from(quotationTemplates)
    .where(
      and(
        eq(quotationTemplates.organizationId, tenantId),
        eq(quotationTemplates.code, code)
      )
    )
    .limit(1)
    .for("update")

  return template ?? null
}

export async function listQuotationTemplates(
  tx: Tx,
  tenantId: string
): Promise<QuotationTemplateRow[]> {
  return tx
    .select()
    .from(quotationTemplates)
    .where(eq(quotationTemplates.organizationId, tenantId))
    .orderBy(asc(quotationTemplates.label))
}

export async function getTenantQuotationTemplateCode(
  tx: Tx,
  tenantId: string
): Promise<string | null> {
  const [settings] = await tx
    .select({ quotationTemplateCode: tenantSettings.quotationTemplateCode })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1)

  return settings?.quotationTemplateCode ?? null
}

export async function updateTenantQuotationTemplateCode(
  tx: Tx,
  tenantId: string,
  quotationTemplateCode: string | null
): Promise<string | null> {
  const [settings] = await tx
    .insert(tenantSettings)
    .values({ organizationId: tenantId, quotationTemplateCode })
    .onConflictDoUpdate({
      target: tenantSettings.organizationId,
      set: { quotationTemplateCode, updatedAt: new Date() },
    })
    .returning({ quotationTemplateCode: tenantSettings.quotationTemplateCode })

  return settings?.quotationTemplateCode ?? null
}

export async function clearTenantQuotationTemplateCode(
  tx: Tx,
  tenantId: string,
  quotationTemplateCode: string
) {
  await tx
    .update(tenantSettings)
    .set({ quotationTemplateCode: null, updatedAt: new Date() })
    .where(
      and(
        eq(tenantSettings.organizationId, tenantId),
        eq(tenantSettings.quotationTemplateCode, quotationTemplateCode)
      )
    )
}

export async function upsertTemplateCodeOnAccount(
  tx: Tx,
  tenantId: string,
  accountId: string,
  rawTemplateCode: string | null
) {
  const code = toNormalizedTemplateCode(rawTemplateCode)
  await tx
    .update(accounts)
    .set({
      quotationTemplateCode: code,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.tenantId, tenantId),
        isNull(accounts.deletedAt)
      )
    )
}
