import { describe, expect, it } from "vitest"
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core"

import { savedViews } from "@/db/schema/saved-views"
import {
  createSavedViewService,
  savedViewRlsAllows,
  savedViewPayloadSchema,
  savedViewOwnerWhere,
  type SavedViewRepository,
  type SavedViewRepositoryInsert,
  type SavedViewRepositoryRow,
  type SavedViewPayload,
  validateSavedViewPayload,
} from "@/lib/saved-views"
import { applySavedViewPayload } from "@/lib/data-table-saved-views"

const payload = {
  filters: {
    global: "acme",
    columns: {
      status: { type: "enum", value: ["open"] },
    },
  },
  sorting: [{ id: "createdAt", desc: true }],
  visibility: { id: true, status: true, createdAt: false },
  pageSize: 50,
} as const

class MemorySavedViewRepository implements SavedViewRepository {
  rows: SavedViewRepositoryRow[] = []

  async list(listKey: string) {
    return this.rows.filter((row) => row.listKey === listKey)
  }

  async get(id: string) {
    return this.rows.find((row) => row.id === id)
  }

  async insert(input: SavedViewRepositoryInsert) {
    const now = new Date("2026-08-17T00:00:00.000Z")
    const row: SavedViewRepositoryRow = {
      ...input,
      id: crypto.randomUUID(),
      isDefault: input.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    }
    this.rows.push(row)
    return row
  }

  async update(id: string, patch: Partial<SavedViewRepositoryRow>) {
    const row = await this.get(id)
    if (!row) return undefined
    Object.assign(row, patch)
    return row
  }

  async delete(id: string) {
    const index = this.rows.findIndex((row) => row.id === id)
    if (index < 0) return false
    this.rows.splice(index, 1)
    return true
  }

  async clearDefaults(listKey: string, owner: { tenantId: string; memberId: string }) {
    for (const row of this.rows) {
      if (
        row.organizationId === owner.tenantId &&
        row.memberId === owner.memberId &&
        row.listKey === listKey
      ) {
        row.isDefault = false
      }
    }
  }

  async transaction<T>(fn: (repository: SavedViewRepository) => Promise<T>): Promise<T> {
    const snapshot = this.rows.map((row) => ({ ...row }))
    try {
      return await fn(this)
    } catch (error) {
      this.rows = snapshot
      throw error
    }
  }
}

const ownerA = { tenantId: "org-a", memberId: "member-a" }
const ownerB = { tenantId: "org-a", memberId: "member-b" }
const servicePayload = payload as unknown as SavedViewPayload

describe("saved views", () => {
  it("stores tenant and member ownership with per-list names and defaults", () => {
    expect(savedViews.organizationId.name).toBe("organization_id")
    expect(savedViews.memberId.name).toBe("member_id")
    expect(savedViews.listKey.name).toBe("list_key")
    expect(savedViews.name.name).toBe("name")
    expect(savedViews.filters.name).toBe("filters")
    expect(savedViews.sorting.name).toBe("sorting")
    expect(savedViews.visibility.name).toBe("visibility")
    expect(savedViews.pageSize.name).toBe("page_size")
    expect(savedViews.isDefault.name).toBe("is_default")

    const config = getTableConfig(savedViews)
    expect(config.uniqueConstraints.find((constraint) => constraint.name === "saved_views_owner_name_uq")?.columns.map((column) => column.name)).toEqual([
      "organization_id",
      "member_id",
      "list_key",
      "name",
    ])
    expect(config.indexes.find((index) => index.config.name === "saved_views_one_default_uq")?.config.where).toBeTruthy()
  })

  it("adds both tenant and member ownership predicates to mutations", () => {
    const query = new PgDialect().sqlToQuery(
      savedViewOwnerWhere(
        { tenantId: "org-1", memberId: "member-1" },
        "00000000-0000-0000-0000-000000000001"
      )
    )
    expect(query.sql).toContain('"saved_views"."organization_id"')
    expect(query.sql).toContain('"saved_views"."member_id"')
    expect(query.params).toEqual(
      expect.arrayContaining(["org-1", "member-1", "00000000-0000-0000-0000-000000000001"])
    )
  })

  it("accepts the saved payload shape and rejects invalid filter payloads", () => {
    expect(savedViewPayloadSchema.parse(payload)).toEqual(payload)
    expect(validateSavedViewPayload(payload)).toEqual({ success: true, value: payload })

    expect(
      validateSavedViewPayload({
        ...payload,
        filters: {
          columns: {
            status: { type: "enum", value: [7] },
          },
        },
      }).success
    ).toBe(false)
    expect(
      validateSavedViewPayload({ ...payload, pageSize: 0 }).success
    ).toBe(false)
  })

  it("performs CRUD with owner isolation and permits zero defaults", async () => {
    const repository = new MemorySavedViewRepository()
    const mine = createSavedViewService(repository, ownerA)
    const other = createSavedViewService(repository, ownerB)

    const saved = await mine.save({ listKey: "accounts", name: "Mine", payload: servicePayload })
    expect((await mine.list("accounts")).map((view) => view.name)).toEqual(["Mine"])
    expect((await mine.list("accounts"))[0]?.isDefault).toBe(false)
    expect(await other.list("accounts")).toEqual([])
    await expect(other.rename(saved.id, "Stolen")).rejects.toThrow("Saved view not found")
    await expect(other.duplicate(saved.id, "Stolen")).rejects.toThrow("Saved view not found")
    await expect(other.delete(saved.id)).rejects.toThrow("Saved view not found")
    expect((await mine.get(saved.id)).name).toBe("Mine")
    await mine.rename(saved.id, "Renamed")
    const duplicate = await mine.duplicate(saved.id, "Copy")
    await mine.delete(duplicate.id)
    expect((await mine.list("accounts")).map((view) => view.name)).toEqual(["Renamed"])
  })

  it("replaces the prior default atomically while keeping at most one", async () => {
    const repository = new MemorySavedViewRepository()
    const mine = createSavedViewService(repository, ownerA)
    const other = createSavedViewService(repository, ownerB)
    const first = await mine.save({ listKey: "accounts", name: "First", payload: servicePayload })
    const second = await mine.save({ listKey: "accounts", name: "Second", payload: servicePayload })
    const otherView = await other.save({ listKey: "accounts", name: "Other", payload: servicePayload })

    await other.setDefault(otherView.id)
    await mine.setDefault(first.id)
    expect((await mine.list("accounts")).filter((view) => view.isDefault).map((view) => view.id)).toEqual([first.id])
    expect((await other.list("accounts")).filter((view) => view.isDefault).map((view) => view.id)).toEqual([otherView.id])
    await mine.setDefault(second.id)
    expect((await mine.list("accounts")).filter((view) => view.isDefault).map((view) => view.id)).toEqual([second.id])
    expect((await other.list("accounts")).filter((view) => view.isDefault).map((view) => view.id)).toEqual([otherView.id])
  })

  it("fails closed when the tenant context is absent or mismatched", () => {
    expect(savedViewRlsAllows("org-a", undefined)).toBe(false)
    expect(savedViewRlsAllows("org-a", null)).toBe(false)
    expect(savedViewRlsAllows("org-a", "org-b")).toBe(false)
    expect(savedViewRlsAllows("org-a", "org-a")).toBe(true)
  })

  it("drops stale sort, filter, and visibility fields when applying a saved view", () => {
    const result = applySavedViewPayload(
      {
        ...servicePayload,
        sorting: [
          { id: "status", desc: false },
          { id: "removedColumn", desc: true },
        ],
        visibility: { status: true, removedColumn: false },
        filters: {
          global: "acme",
          columns: {
            status: { type: "enum", value: ["open"] },
            removedColumn: { type: "enum", value: ["gone"] },
          },
        },
      },
      ["id", "status"],
      [{ type: "enum", columnId: "status", options: [{ value: "open", label: "Open" }] }],
      []
    )

    expect(result.stale).toBe(true)
    expect(result.sorting).toEqual([{ id: "status", desc: false }])
    expect(result.columnFilters).toEqual([
      { id: "status", value: { type: "enum", value: ["open"] } },
    ])
    expect(result.columnVisibility).toEqual({ status: true })
    expect(result.globalFilter).toBe("acme")
  })

  it("exports the authenticated per-user saved-view actions", async () => {
    const actions = await import("@/app/(app)/_shared/saved-view-actions")
    expect(Object.keys(actions)).toEqual(
      expect.arrayContaining([
        "listSavedViews",
        "saveView",
        "renameView",
        "duplicateView",
        "setDefaultView",
        "deleteView",
      ])
    )
  })
})
