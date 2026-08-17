import type {
  ColumnFiltersState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table"
import type { SavedViewPayload } from "@/lib/saved-views"
import {
  validateFilterValue,
  type DataTableFilterDefinition,
} from "@/lib/data-table-filters"

export type SavedViewApplicationResult = {
  sorting: SortingState
  columnFilters: ColumnFiltersState
  globalFilter: string
  columnVisibility: VisibilityState
  pageSize: number
  stale: boolean
}

export function applySavedViewPayload(
  payload: SavedViewPayload,
  columnIds: readonly string[],
  filters: readonly DataTableFilterDefinition[],
  facetColumnIds: readonly string[]
): SavedViewApplicationResult {
  const knownColumnIds = new Set(columnIds)
  let stale = false
  const sorting = payload.sorting.filter((sort) => {
    const valid = knownColumnIds.has(sort.id)
    stale ||= !valid
    return valid
  })
  const columnVisibility = Object.fromEntries(
    Object.entries(payload.visibility).filter(([id]) => {
      const valid = knownColumnIds.has(id)
      stale ||= !valid
      return valid
    })
  )
  const columnFilters: ColumnFiltersState = []
  for (const [id, value] of Object.entries(payload.filters.columns)) {
    if (!knownColumnIds.has(id)) {
      stale = true
      continue
    }
    const definition = filters.find((filter) => filter.columnId === id)
    if (definition) {
      const validation = validateFilterValue(value)
      if (!validation.success || validation.value.type !== definition.type) {
        stale = true
        continue
      }
      columnFilters.push({ id, value: validation.value })
    } else if (facetColumnIds.includes(id) && Array.isArray(value) && value.every((item) => typeof item === "string")) {
      columnFilters.push({ id, value })
    } else {
      stale = true
    }
  }

  return {
    sorting,
    columnFilters,
    globalFilter: payload.filters.global ?? "",
    columnVisibility,
    pageSize: payload.pageSize,
    stale,
  }
}
