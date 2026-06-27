"use server"

import { and, asc, eq, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant } from "@/lib/actions"
import { type ActionResult, runAction } from "@/lib/action-result"
import { PERMISSIONS } from "@/lib/permissions"
import { taxSettings } from "@/db/schema"
import { writeAudit } from "@/server/audit"
import type { Tx } from "@/db"

export type TaxSettingRow = typeof taxSettings.$inferSelect

/**
 * Guarantee the tenant has exactly one active default tax: if none of the
 * active rows is the default, promote the first active row. No-op when there are
 * no active rows. Call after any delete / default-removal so new quotations
 * always resolve a sensible default.
 */
async function ensureActiveDefaultTax(tx: Tx): Promise<void> {
  const rows = await tx.select().from(taxSettings)
  if (rows.some((r) => r.isDefault && r.isActive)) return
  const candidate = rows.find((r) => r.isActive)
  if (!candidate) return
  await tx
    .update(taxSettings)
    .set({ isDefault: false })
    .where(eq(taxSettings.isDefault, true))
  await tx
    .update(taxSettings)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(taxSettings.id, candidate.id))
}

export type TaxInput = {
  name: string
  ratePercent: string
  isDefault: boolean
  isActive: boolean
}

/** All tax settings for the tenant, default first then by name. */
export async function listTaxSettings(): Promise<TaxSettingRow[]> {
  return withTenant(PERMISSIONS.TAX_VIEW, (tx) =>
    tx
      .select()
      .from(taxSettings)
      .orderBy(asc(taxSettings.name))
  )
}

export async function createTax(
  input: TaxInput
): Promise<ActionResult<TaxSettingRow>> {
  return runAction(async () => {
  const row = await withTenant(PERMISSIONS.TAX_CONFIGURE, async (tx, ctx) => {
    if (input.isDefault) {
      await tx
        .update(taxSettings)
        .set({ isDefault: false })
        .where(eq(taxSettings.isDefault, true))
    }
    const [created] = await tx
      .insert(taxSettings)
      .values({
        tenantId: ctx.tenantId,
        name: input.name.trim(),
        ratePercent: input.ratePercent,
        isDefault: input.isDefault,
        isActive: input.isActive,
      })
      .returning()
    await writeAudit(tx, ctx, {
      action: "tax.created",
      entityType: "tax_setting",
      entityId: created.id,
      after: { name: created.name, ratePercent: created.ratePercent },
    })
    return created
  })
  revalidatePath("/tax-settings")
  return row
  })
}

export async function updateTax(
  id: string,
  input: TaxInput
): Promise<ActionResult<TaxSettingRow>> {
  return runAction(async () => {
  const row = await withTenant(PERMISSIONS.TAX_CONFIGURE, async (tx, ctx) => {
    const [existing] = await tx
      .select()
      .from(taxSettings)
      .where(eq(taxSettings.id, id))
      .limit(1)
    if (!existing) throw new Error("Tax setting not found")
    // The default tax must remain selectable on new quotations.
    if (existing.isDefault && input.isDefault && !input.isActive) {
      throw new Error(
        "The default tax must stay active. Make another tax the default before deactivating this one."
      )
    }
    if (input.isDefault) {
      await tx
        .update(taxSettings)
        .set({ isDefault: false })
        .where(and(ne(taxSettings.id, id), eq(taxSettings.isDefault, true)))
    }
    const [updated] = await tx
      .update(taxSettings)
      .set({
        name: input.name.trim(),
        ratePercent: input.ratePercent,
        isDefault: input.isDefault,
        isActive: input.isActive,
        updatedAt: new Date(),
      })
      .where(eq(taxSettings.id, id))
      .returning()
    if (!updated) throw new Error("Tax setting not found")
    // Removing default status (or deactivating) could leave the tenant with no
    // usable default — auto-promote another active tax so one always exists.
    await ensureActiveDefaultTax(tx)
    await writeAudit(tx, ctx, {
      action: "tax.updated",
      entityType: "tax_setting",
      entityId: updated.id,
      after: { name: updated.name, ratePercent: updated.ratePercent },
    })
    return updated
  })
  revalidatePath("/tax-settings")
  return row
  })
}

/** Hard delete — tax settings are configuration, not soft-deleted business rows. */
export async function deleteTax(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
  await withTenant(PERMISSIONS.TAX_CONFIGURE, async (tx, ctx) => {
    await tx.delete(taxSettings).where(eq(taxSettings.id, id))
    // If we just removed the default, promote another active tax so new
    // quotations still resolve a default.
    await ensureActiveDefaultTax(tx)
    await writeAudit(tx, ctx, {
      action: "tax.deleted",
      entityType: "tax_setting",
      entityId: id,
    })
  })
  revalidatePath("/tax-settings")
  })
}

export async function setDefaultTax(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
  await withTenant(PERMISSIONS.TAX_CONFIGURE, async (tx, ctx) => {
    await tx
      .update(taxSettings)
      .set({ isDefault: false })
      .where(and(ne(taxSettings.id, id), eq(taxSettings.isDefault, true)))
    const [updated] = await tx
      .update(taxSettings)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(taxSettings.id, id))
      .returning()
    if (!updated) throw new Error("Tax setting not found")
    await writeAudit(tx, ctx, {
      action: "tax.set_default",
      entityType: "tax_setting",
      entityId: id,
    })
  })
  revalidatePath("/tax-settings")
  })
}
