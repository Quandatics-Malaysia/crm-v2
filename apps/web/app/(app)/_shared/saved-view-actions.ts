"use server"

import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"
import { runInTenant } from "@/db"
import { savedViews, type SavedViewRow } from "@/db/schema"
import { validateFilterValue, type DataTableFilterValue } from "@/lib/data-table-filters"
import { requireContext } from "@/lib/actions"
import { runAction, type ActionResult } from "@/lib/action-result"

export type SavedViewFilters = {
  global?: string
  columns: Record<string, DataTableFilterValue | readonly string[]>
}

export type SavedViewPayload = {
  filters: SavedViewFilters
  sorting: { id: string; desc: boolean }[]
  visibility: Record<string, boolean>
  pageSize: number
}

export type SavedView = {
  id: string
  listKey: string
  name: string
  payload: SavedViewPayload
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

const filterColumnsSchema = z.record(z.string().min(1).max(100), z.unknown()).superRefine(
  (columns, context) => {
    for (const [columnId, value] of Object.entries(columns)) {
      const validFacet =
        Array.isArray(value) && value.every((item) => typeof item === "string")
      if (!validFacet && !validateFilterValue(value).success) {
        context.addIssue({
          code: "custom",
          path: [columnId],
          message: "Invalid data table filter.",
        })
      }
    }
  }
)

export const savedViewPayloadSchema = z
  .object({
    filters: z
      .object({
        global: z.string().max(500).optional(),
        columns: filterColumnsSchema,
      })
      .strict(),
    sorting: z
      .array(
        z.object({ id: z.string().min(1).max(100), desc: z.boolean() }).strict()
      )
      .max(50),
    visibility: z.record(z.string().min(1).max(100), z.boolean()),
    pageSize: z.number().int().min(1).max(1000),
  })
  .strict()

export function validateSavedViewPayload(input: unknown):
  | { success: true; value: SavedViewPayload }
  | { success: false; error: string } {
  const parsed = savedViewPayloadSchema.safeParse(input)
  if (parsed.success) return { success: true, value: parsed.data as SavedViewPayload }
  return {
    success: false,
    error: parsed.error.issues[0]?.message ?? "Invalid saved view payload.",
  }
}

const listKeySchema = z.string().trim().min(1).max(100)
const nameSchema = z.string().trim().min(1).max(100)
const viewIdSchema = z.string().uuid()
const saveViewInputSchema = z
  .object({ listKey: listKeySchema, name: nameSchema, payload: savedViewPayloadSchema })
  .strict()

export function savedViewOwnerWhere(
  ctx: { tenantId: string; memberId: string },
  id: string
) {
  return and(
    eq(savedViews.id, id),
    eq(savedViews.organizationId, ctx.tenantId),
    eq(savedViews.memberId, ctx.memberId)
  )!
}

function requireMember(ctx: Awaited<ReturnType<typeof requireContext>>) {
  if (!ctx.memberId) throw new Error("An active member is required for saved views.")
  return { tenantId: ctx.tenantId, memberId: ctx.memberId }
}

function toSavedView(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    listKey: row.listKey,
    name: row.name,
    payload: {
      filters: row.filters as SavedViewPayload["filters"],
      sorting: row.sorting as SavedViewPayload["sorting"],
      visibility: row.visibility as SavedViewPayload["visibility"],
      pageSize: row.pageSize,
    },
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listSavedViews(listKey: string): Promise<SavedView[]> {
  const ctx = requireMember(await requireContext())
  const parsedListKey = listKeySchema.parse(listKey)
  return runInTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.organizationId, ctx.tenantId),
          eq(savedViews.memberId, ctx.memberId),
          eq(savedViews.listKey, parsedListKey)
        )
      )
      .orderBy(asc(savedViews.name))
    return rows.map(toSavedView)
  })
}

export async function saveView(
  input: z.input<typeof saveViewInputSchema>
): Promise<ActionResult<SavedView>> {
  return runAction(async () => {
    const parsed = saveViewInputSchema.parse(input)
    const ctx = requireMember(await requireContext())
    const [row] = await runInTenant(ctx.tenantId, (tx) =>
      tx
        .insert(savedViews)
        .values({
          organizationId: ctx.tenantId,
          memberId: ctx.memberId,
          listKey: parsed.listKey,
          name: parsed.name,
          filters: parsed.payload.filters,
          sorting: parsed.payload.sorting,
          visibility: parsed.payload.visibility,
          pageSize: parsed.payload.pageSize,
        })
        .returning()
    )
    return toSavedView(row)
  })
}

export async function renameView(
  id: string,
  name: string
): Promise<ActionResult<SavedView>> {
  return runAction(async () => {
    const parsedId = viewIdSchema.parse(id)
    const parsedName = nameSchema.parse(name)
    const ctx = requireMember(await requireContext())
    const [row] = await runInTenant(ctx.tenantId, (tx) =>
      tx
        .update(savedViews)
        .set({ name: parsedName, updatedAt: new Date() })
        .where(savedViewOwnerWhere(ctx, parsedId))
        .returning()
    )
    if (!row) throw new Error("Saved view not found.")
    return toSavedView(row)
  })
}

export async function duplicateView(
  id: string,
  name: string
): Promise<ActionResult<SavedView>> {
  return runAction(async () => {
    const parsedId = viewIdSchema.parse(id)
    const parsedName = nameSchema.parse(name)
    const ctx = requireMember(await requireContext())
    const result = await runInTenant(ctx.tenantId, async (tx) => {
      const [source] = await tx
        .select()
        .from(savedViews)
        .where(savedViewOwnerWhere(ctx, parsedId))
        .limit(1)
      if (!source) throw new Error("Saved view not found.")
      const [row] = await tx
        .insert(savedViews)
        .values({
          organizationId: ctx.tenantId,
          memberId: ctx.memberId,
          listKey: source.listKey,
          name: parsedName,
          filters: source.filters,
          sorting: source.sorting,
          visibility: source.visibility,
          pageSize: source.pageSize,
        })
        .returning()
      return row
    })
    return toSavedView(result)
  })
}

export async function setDefaultView(id: string): Promise<ActionResult<SavedView>> {
  return runAction(async () => {
    const parsedId = viewIdSchema.parse(id)
    const ctx = requireMember(await requireContext())
    const row = await runInTenant(ctx.tenantId, async (tx) => {
      const [selected] = await tx
        .select({ listKey: savedViews.listKey })
        .from(savedViews)
        .where(savedViewOwnerWhere(ctx, parsedId))
        .limit(1)
      if (!selected) throw new Error("Saved view not found.")

      await tx
        .update(savedViews)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(savedViews.organizationId, ctx.tenantId),
            eq(savedViews.memberId, ctx.memberId),
            eq(savedViews.listKey, selected.listKey),
            eq(savedViews.isDefault, true)
          )
        )

      const [updated] = await tx
        .update(savedViews)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(savedViewOwnerWhere(ctx, parsedId))
        .returning()
      if (!updated) throw new Error("Saved view not found.")
      return updated
    })
    return toSavedView(row)
  })
}

export async function deleteView(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsedId = viewIdSchema.parse(id)
    const ctx = requireMember(await requireContext())
    await runInTenant(ctx.tenantId, async (tx) => {
      const rows = await tx.delete(savedViews).where(savedViewOwnerWhere(ctx, parsedId)).returning({ id: savedViews.id })
      if (!rows.length) throw new Error("Saved view not found.")
    })
  })
}
