"use server"

import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { runInTenant, type Tx } from "@/db"
import { savedViews } from "@/db/schema"
import { requireContext } from "@/lib/actions"
import { runAction, type ActionResult } from "@/lib/action-result"

import {
  createSavedViewService,
  savedViewPayloadSchema,
  type SavedView,
  type SavedViewPayload,
  type SavedViewRepository,
  type SavedViewRepositoryRow,
} from "@/lib/saved-views"

const listKeySchema = z.string().trim().min(1).max(100)
const nameSchema = z.string().trim().min(1).max(100)
const viewIdSchema = z.string().uuid()
const saveViewInputSchema = z
  .object({ listKey: listKeySchema, name: nameSchema, payload: savedViewPayloadSchema })
  .strict()

function createSqlSavedViewRepository(tx: Tx): SavedViewRepository {
  return {
    async list(listKey) {
      return tx.select().from(savedViews).where(eq(savedViews.listKey, listKey))
    },
    async get(id) {
      const [row] = await tx.select().from(savedViews).where(eq(savedViews.id, id)).limit(1)
      return row
    },
    async insert(input) {
      const [row] = await tx.insert(savedViews).values(input).returning()
      return row
    },
    async update(id, patch) {
      const [row] = await tx
        .update(savedViews)
        .set({ ...patch, updatedAt: patch.updatedAt ?? new Date() })
        .where(eq(savedViews.id, id))
        .returning()
      return row
    },
    async delete(id) {
      const rows = await tx.delete(savedViews).where(eq(savedViews.id, id)).returning({ id: savedViews.id })
      return rows.length > 0
    },
    async clearDefaults(listKey, owner) {
      await tx
        .update(savedViews)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(savedViews.organizationId, owner.tenantId),
            eq(savedViews.memberId, owner.memberId),
            eq(savedViews.listKey, listKey),
            eq(savedViews.isDefault, true)
          )
        )
    },
    async transaction(fn) {
      return fn(this)
    },
  }
}

function requireMember(ctx: Awaited<ReturnType<typeof requireContext>>) {
  if (!ctx.memberId) throw new Error("An active member is required for saved views.")
  return { tenantId: ctx.tenantId, memberId: ctx.memberId }
}

function toSavedView(row: SavedViewRepositoryRow): SavedView {
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
  return runInTenant(ctx.tenantId, async (tx) => {
    const service = createSavedViewService(createSqlSavedViewRepository(tx), ctx)
    return (await service.list(listKey)).map(toSavedView)
  })
}

export async function saveView(
  input: z.input<typeof saveViewInputSchema>
): Promise<ActionResult<SavedView>> {
  return runAction(async () => {
    const parsed = saveViewInputSchema.parse(input)
    const ctx = requireMember(await requireContext())
    return runInTenant(ctx.tenantId, async (tx) => {
      const service = createSavedViewService(createSqlSavedViewRepository(tx), ctx)
      return toSavedView(await service.save(parsed))
    })
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
    return runInTenant(ctx.tenantId, async (tx) => {
      const service = createSavedViewService(createSqlSavedViewRepository(tx), ctx)
      return toSavedView(await service.rename(parsedId, parsedName))
    })
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
    return runInTenant(ctx.tenantId, async (tx) => {
      const service = createSavedViewService(createSqlSavedViewRepository(tx), ctx)
      return toSavedView(await service.duplicate(parsedId, parsedName))
    })
  })
}

export async function setDefaultView(id: string): Promise<ActionResult<SavedView>> {
  return runAction(async () => {
    const parsedId = viewIdSchema.parse(id)
    const ctx = requireMember(await requireContext())
    return runInTenant(ctx.tenantId, async (tx) => {
      const service = createSavedViewService(createSqlSavedViewRepository(tx), ctx)
      return toSavedView(await service.setDefault(parsedId))
    })
  })
}

export async function deleteView(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsedId = viewIdSchema.parse(id)
    const ctx = requireMember(await requireContext())
    await runInTenant(ctx.tenantId, async (tx) => {
      const service = createSavedViewService(createSqlSavedViewRepository(tx), ctx)
      await service.delete(parsedId)
    })
  })
}
