import { describe, expect, it } from "vitest"
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core"

import { savedViews } from "@/db/schema/saved-views"
import {
  savedViewPayloadSchema,
  savedViewOwnerWhere,
  validateSavedViewPayload,
} from "@/app/(app)/_shared/saved-view-actions"

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
