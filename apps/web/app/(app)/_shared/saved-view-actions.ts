"use server"

import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { runInTenant, type Tx } from "@/db"
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

type SavedViewOwner = { tenantId: string; memberId: string }

export type SavedViewRepositoryRow = SavedViewRow
export type SavedViewRepositoryInsert = Pick<
  SavedViewRow,
  | "organizationId"
  | "memberId"
  | "listKey"
  | "name"
  | "filters"
  | "sorting"
  | "visibility"
  | "pageSize"
  | "isDefault"
>

export interface SavedViewRepository {
  list(listKey: string): Promise<SavedViewRepositoryRow[]>
  get(id: string): Promise<SavedViewRepositoryRow | undefined>
  insert(input: SavedViewRepositoryInsert): Promise<SavedViewRepositoryRow>
  update(
    id: string,
    patch: Partial<SavedViewRepositoryRow>
  ): Promise<SavedViewRepositoryRow | undefined>
  delete(id: string): Promise<boolean>
  clearDefaults(listKey: string, owner: SavedViewOwner): Promise<void>
  transaction<T>(fn: (repository: SavedViewRepository) => Promise<T>): Promise<T>
}

export function savedViewRlsAllows(
  rowOrganizationId: string,
  currentTenantId: string | null | undefined
) {
  return Boolean(currentTenantId) && rowOrganizationId === currentTenantId
}

function assertOwned(row: SavedViewRepositoryRow | undefined, owner: SavedViewOwner) {
  if (
    !row ||
    !savedViewRlsAllows(row.organizationId, owner.tenantId) ||
    row.memberId !== owner.memberId
  ) {
    throw new Error("Saved view not found.")
  }
  return row
}

export function createSavedViewService(
  repository: SavedViewRepository,
  owner: SavedViewOwner
) {
  return {
    async list(listKey: string) {
      const parsedListKey = listKeySchema.parse(listKey)
      const rows = await repository.list(parsedListKey)
      return rows
        .filter(
          (row) =>
            savedViewRlsAllows(row.organizationId, owner.tenantId) &&
            row.memberId === owner.memberId
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    async get(id: string) {
      return assertOwned(await repository.get(viewIdSchema.parse(id)), owner)
    },
    async save(input: z.input<typeof saveViewInputSchema>) {
      const parsed = saveViewInputSchema.parse(input)
      return repository.insert({
        organizationId: owner.tenantId,
        memberId: owner.memberId,
        listKey: parsed.listKey,
        name: parsed.name,
        filters: parsed.payload.filters,
        sorting: parsed.payload.sorting,
        visibility: parsed.payload.visibility,
        pageSize: parsed.payload.pageSize,
        isDefault: false,
      })
    },
    async rename(id: string, name: string) {
      const row = assertOwned(await repository.get(viewIdSchema.parse(id)), owner)
      const parsedName = nameSchema.parse(name)
      return assertOwned(
        await repository.update(row.id, { name: parsedName, updatedAt: new Date() }),
        owner
      )
    },
    async duplicate(id: string, name: string) {
      const source = assertOwned(await repository.get(viewIdSchema.parse(id)), owner)
      const parsedName = nameSchema.parse(name)
      return repository.insert({
        organizationId: owner.tenantId,
        memberId: owner.memberId,
        listKey: source.listKey,
        name: parsedName,
        filters: source.filters,
        sorting: source.sorting,
        visibility: source.visibility,
        pageSize: source.pageSize,
        isDefault: false,
      })
    },
    async setDefault(id: string) {
      const parsedId = viewIdSchema.parse(id)
      return repository.transaction(async (transactionRepository) => {
        const selected = assertOwned(await transactionRepository.get(parsedId), owner)
        await transactionRepository.clearDefaults(selected.listKey, owner)
        return assertOwned(
          await transactionRepository.update(selected.id, {
            isDefault: true,
            updatedAt: new Date(),
          }),
          owner
        )
      })
    },
    async delete(id: string) {
      const row = assertOwned(await repository.get(viewIdSchema.parse(id)), owner)
      if (!(await repository.delete(row.id))) throw new Error("Saved view not found.")
    },
  }
}

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
