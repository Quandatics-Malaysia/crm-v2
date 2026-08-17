"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { formatMoney } from "@/lib/format"
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  matchesFilter,
  parseDataTableFilterParam,
  validateFilterValue,
  type DataTableFilterDefinition,
  type DataTableFilterValue,
  type DateFilterOperator,
  type NumericFilterOperator,
  type TextFilterOperator,
} from "@/lib/data-table-filters"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EmptyState } from "@/components/empty-state"
import { SavedViewMenu } from "@/components/saved-view-menu"
import type { SavedViewPayload } from "@/lib/saved-views"
import { applySavedViewPayload } from "@/lib/data-table-saved-views"
import type { LucideIcon } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export interface DataTableFacet {
  columnId: string
  title: string
}

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchColumn?: string
  searchPlaceholder?: string
  /** Title shown in the empty state when there are no rows. */
  emptyMessage?: string
  /** Optional guidance copy under the empty-state title. */
  emptyDescription?: string
  /** Optional icon for the empty state. */
  emptyIcon?: LucideIcon
  /** Optional call-to-action (e.g. a create button) for the empty state. */
  emptyAction?: React.ReactNode
  toolbar?: React.ReactNode
  pageSize?: number
  /** Typed, datatype-aware column filters. */
  filters?: DataTableFilterDefinition[]
  /** Columns to expose as multi-select faceted filters. */
  facets?: DataTableFacet[]
  /** Namespaces the URL state params so multiple tables can coexist on a page. */
  tableId?: string
  /** Explicitly disable saved views only for a table that cannot persist them. */
  savedViews?: boolean
  /**
   * Server-side row cap. When `data.length >= cap`, a notice is shown so users
   * know the list is truncated and should refine their search.
   */
  cap?: number
}

const facetFilterFn = (
  row: { getValue: (id: string) => unknown },
  id: string,
  value: string[]
) => !value?.length || value.includes(String(row.getValue(id)))

const typedFilterFn = (
  row: { getValue: (id: string) => unknown },
  id: string,
  value: DataTableFilterValue
) => matchesFilter(row.getValue(id), value)

function hasActiveFilterValue(value: DataTableFilterValue | undefined): boolean {
  if (!value) return false
  switch (value.type) {
    case "text":
      return value.value != null && value.value.trim() !== ""
    case "number":
    case "money":
      return value.operator === "between"
        ? value.min != null && value.max != null
        : value.value != null
    case "date":
      return value.operator === "between"
        ? value.from != null && value.to != null
        : value.value != null && value.value !== ""
    case "boolean":
      return value.value != null
    case "enum":
      return !!value.value?.length
    case "relation":
      return Array.isArray(value.value) ? value.value.length > 0 : !!value.value
  }
}

// Global search: a row matches when ANY column's value contains the query
// (case-insensitive substring). tanstack ORs this across every filterable
// column, so one search box searches the whole table — the right behaviour as
// the imported data set keeps growing.
const globalFilterFn = (
  row: { getValue: (id: string) => unknown },
  columnId: string,
  value: string
) => {
  const cell = row.getValue(columnId)
  if (cell == null) return false
  return String(cell).toLowerCase().includes(String(value).toLowerCase())
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchColumn,
  searchPlaceholder = "Search…",
  emptyMessage = "No results.",
  emptyDescription,
  emptyIcon,
  emptyAction,
  toolbar,
  pageSize = 25,
  filters,
  facets,
  tableId,
  savedViews = true,
  cap,
}: DataTableProps<TData, TValue>) {
  const filterIds = React.useMemo(
    () => new Set((filters ?? []).map((filter) => filter.columnId)),
    [filters]
  )
  const facetIds = React.useMemo(
    () => new Set((facets ?? []).map((f) => f.columnId)),
    [facets]
  )

  // inject a faceted filterFn for facet columns so multi-select arrays work
  const tableColumns = React.useMemo(
    () =>
      columns.map((c) => {
        const id =
          (c as { id?: string; accessorKey?: string }).id ??
          (c as { accessorKey?: string }).accessorKey
        if (id && filterIds.has(id)) return { ...c, filterFn: typedFilterFn }
        return id && facetIds.has(id) ? { ...c, filterFn: facetFilterFn } : c
      }),
    [columns, facetIds, filterIds]
  )

  // --- URL-persisted table state (bookmarkable / shareable / survives nav) ---
  const searchParams = useSearchParams()
  const pathname = usePathname()
  // Namespace params per table so multiple tables on one page don't collide.
  const key = React.useCallback(
    (name: string) => (tableId ? `${tableId}_${name}` : name),
    [tableId]
  )

  // Read the initial state from the URL exactly once on mount.
  const initial = React.useMemo(() => {
    const sorting: SortingState = []
    const sortParam = searchParams.get(key("sort"))
    if (sortParam) {
      for (const piece of sortParam.split(",")) {
        const [id, dir] = piece.split(":")
        if (id) sorting.push({ id, desc: dir === "desc" })
      }
    }

    const columnFilters: ColumnFiltersState = []
    for (const filter of filters ?? []) {
      const typedValue = parseDataTableFilterParam(
        searchParams.get(key(`f_${filter.columnId}`)),
        filter.type
      )
      if (
        typedValue &&
        typedValue.type === filter.type &&
        hasActiveFilterValue(typedValue)
      ) {
        columnFilters.push({ id: filter.columnId, value: typedValue })
      }
    }
    for (const f of facets ?? []) {
      if (filterIds.has(f.columnId)) continue
      const v = searchParams.get(key(`f_${f.columnId}`))
      if (v) columnFilters.push({ id: f.columnId, value: v.split(",") })
    }

    const globalFilter = searchParams.get(key("q")) ?? ""

    const columnVisibility: VisibilityState = {}
    const hidden = searchParams.get(key("hide"))
    if (hidden) for (const c of hidden.split(",")) columnVisibility[c] = false

    const pageIndex = Math.max(0, (Number(searchParams.get(key("page"))) || 1) - 1)
    const size = Number(searchParams.get(key("size"))) || pageSize

    return {
      sorting,
      columnFilters,
      globalFilter,
      columnVisibility,
      pagination: { pageIndex, pageSize: size } as PaginationState,
    }
    // Intentionally read the URL once on mount; state is the source of truth after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [sorting, setSorting] = React.useState<SortingState>(initial.sorting)
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    initial.columnFilters
  )
  const [globalFilter, setGlobalFilter] = React.useState<string>(
    initial.globalFilter
  )
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    initial.columnVisibility
  )
  const [pagination, setPagination] = React.useState<PaginationState>(
    initial.pagination
  )
  const [rowSelection, setRowSelection] = React.useState({})

  const hasInitialUrlState =
    initial.sorting.length > 0 ||
    initial.columnFilters.length > 0 ||
    initial.globalFilter.length > 0 ||
    Object.keys(initial.columnVisibility).length > 0 ||
    initial.pagination.pageIndex > 0 ||
    initial.pagination.pageSize !== pageSize

  // Write state back to the URL whenever it changes, using history.replaceState
  // (NOT router.replace): a soft router navigation re-runs the server component,
  // which hands us a fresh `data` array whose new reference trips tanstack's
  // autoResetPageIndex and snaps pagination back — so Next/sort/filter would
  // "jump back". history.replaceState keeps the URL bookmarkable while leaving
  // `data` stable and avoiding a server round-trip (instant, smooth).
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    if (sorting.length)
      params.set(
        key("sort"),
        sorting.map((s) => `${s.id}:${s.desc ? "desc" : "asc"}`).join(",")
      )
    else params.delete(key("sort"))

    if (globalFilter) params.set(key("q"), globalFilter)
    else params.delete(key("q"))

    for (const f of facets ?? []) {
      if (filterIds.has(f.columnId)) continue
      const fv = columnFilters.find((c) => c.id === f.columnId)?.value as
        | string[]
        | undefined
      if (fv && fv.length) params.set(key(`f_${f.columnId}`), fv.join(","))
      else params.delete(key(`f_${f.columnId}`))
    }

    for (const filter of filters ?? []) {
      const fv = columnFilters.find((c) => c.id === filter.columnId)?.value as
        | DataTableFilterValue
        | undefined
      const validation = fv ? validateFilterValue(fv) : null
      if (
        fv &&
        fv.type === filter.type &&
        validation?.success &&
        hasActiveFilterValue(fv)
      ) {
        params.set(key(`f_${filter.columnId}`), JSON.stringify(fv))
      } else {
        params.delete(key(`f_${filter.columnId}`))
      }
    }

    const hiddenCols = Object.entries(columnVisibility)
      .filter(([, v]) => v === false)
      .map(([id]) => id)
    if (hiddenCols.length) params.set(key("hide"), hiddenCols.join(","))
    else params.delete(key("hide"))

    if (pagination.pageIndex > 0)
      params.set(key("page"), String(pagination.pageIndex + 1))
    else params.delete(key("page"))
    if (pagination.pageSize !== pageSize)
      params.set(key("size"), String(pagination.pageSize))
    else params.delete(key("size"))

    const qs = params.toString()
    const current = window.location.search.replace(/^\?/, "")
    if (qs !== current) {
      window.history.replaceState(
        null,
        "",
        qs ? `${pathname}?${qs}` : pathname
      )
    }
  }, [
    sorting,
    columnFilters,
    globalFilter,
    columnVisibility,
    pagination,
    facets,
    filters,
    filterIds,
    pageSize,
    key,
    pathname,
  ])

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      columnVisibility,
      pagination,
      rowSelection,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  // Search is shown whenever a caller opts in via `searchColumn` (kept as the
  // enable flag) — but it now filters ACROSS ALL columns, not just that one.
  const showSearch = !!searchColumn
  const hasActiveFilters = columnFilters.length > 0 || globalFilter.length > 0

  const currentSavedPayload = React.useMemo<SavedViewPayload>(
    () => ({
      filters: {
        ...(globalFilter ? { global: globalFilter } : {}),
        columns: Object.fromEntries(columnFilters.map((filter) => [filter.id, filter.value])) as SavedViewPayload["filters"]["columns"],
      },
      sorting: sorting.map(({ id, desc }) => ({ id, desc })),
      visibility: columnVisibility,
      pageSize: pagination.pageSize,
    }),
    [columnFilters, columnVisibility, globalFilter, pagination.pageSize, sorting]
  )

  const applySavedView = React.useCallback(
    (payload: SavedViewPayload) => {
      const result = applySavedViewPayload(
        payload,
        columns.map(
          (column) =>
            (column as { id?: string; accessorKey?: string }).id ??
            (column as { accessorKey?: string }).accessorKey
        ).filter((id): id is string => !!id),
        filters ?? [],
        (facets ?? []).map((facet) => facet.columnId)
      )
      setSorting(result.sorting)
      setColumnFilters(result.columnFilters)
      setGlobalFilter(payload.filters.global ?? "")
      setColumnVisibility(result.columnVisibility)
      setPagination({ pageIndex: 0, pageSize: result.pageSize })
      if (result.stale) toast.warning("Some saved view columns are no longer available.")
    },
    [columns, facets, filters]
  )

  const resetToBaseView = React.useCallback(() => {
    setSorting([])
    setColumnFilters([])
    setGlobalFilter("")
    setColumnVisibility({})
    setPagination({ pageIndex: 0, pageSize })
  }, [pageSize])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {showSearch ? (
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="px-8"
            />
            {globalFilter ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setGlobalFilter("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        ) : null}

        {(filters ?? []).map((filter) => {
          const col = table.getColumn(filter.columnId)
          if (!col) return null
          return (
            <TypedFilter
              key={filter.columnId}
              column={col}
              definition={filter}
            />
          )
        })}

        {(facets ?? []).map((f) => {
          if (filterIds.has(f.columnId)) return null
          const col = table.getColumn(f.columnId)
          if (!col) return null
          return <FacetFilter key={f.columnId} column={col} title={f.title} />
        })}

        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setColumnFilters([])
              setGlobalFilter("")
            }}
            className="text-muted-foreground"
          >
            <X className="size-4" /> Reset
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          {tableId && savedViews ? (
            <SavedViewMenu
              listKey={tableId}
              currentPayload={currentSavedPayload}
              applyDefault={!hasInitialUrlState}
              onApply={applySavedView}
              onReset={resetToBaseView}
            />
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" aria-label="Toggle columns">
                  <SlidersHorizontal className="size-4" />
                  <span className="hidden sm:inline">Columns</span>
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                {table
                  .getAllColumns()
                  .filter((c) => c.getCanHide())
                  .map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(!!value)}
                    >
                      {column.id.replace(/_/g, " ")}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {cap != null && data.length >= cap ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          Showing the most recent {cap} — refine your search to see more.
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  <EmptyState
                    icon={emptyIcon}
                    title={emptyMessage}
                    description={emptyDescription}
                    action={emptyAction}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {hasActiveFilters
            ? `${table.getFilteredRowModel().rows.length} of ${data.length} row(s)`
            : `${data.length} row(s)`}
        </span>
        <div className="flex items-center gap-2">
          <span className="hidden text-sm text-muted-foreground sm:inline">Per page</span>
          <Select
            value={String(table.getState().pagination.pageSize)}
            onValueChange={(v) => table.setPageSize(Number(v))}
          >
            <SelectTrigger className="h-8 w-[4.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="size-4" />
            Prev
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount() || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

type FilterColumn = Pick<
  Column<unknown, unknown>,
  "getFilterValue" | "setFilterValue"
>

function setTypedFilter(column: FilterColumn, value: DataTableFilterValue) {
  column.setFilterValue(value)
}

function clearTypedFilter(column: FilterColumn) {
  column.setFilterValue(undefined)
}

function filterTitle(definition: DataTableFilterDefinition): string {
  return definition.title ?? definition.label ?? definition.columnId
}

function filterOperators(
  configured: readonly string[] | undefined,
  fallback: readonly string[]
): readonly string[] {
  const allowed = configured?.filter((operator) => fallback.includes(operator))
  return allowed?.length ? allowed : fallback
}

function defaultOperator<T extends string>(
  configured: readonly T[] | undefined,
  fallback: readonly T[],
  current: string | undefined
): T {
  const options = filterOperators(configured, fallback)
  return (current && options.includes(current as T) ? current : options[0]) as T
}

function OperatorSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}) {
  return (
    <select
      aria-label="Filter operator"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option.replace(/-/g, " ")}
        </option>
      ))}
    </select>
  )
}

function TypedFilter<TData, TValue>({
  column,
  definition,
}: {
  column: Column<TData, TValue>
  definition: DataTableFilterDefinition
}) {
  const filterColumn = column as unknown as FilterColumn
  const current = column.getFilterValue() as DataTableFilterValue | undefined
  const title = filterTitle(definition)
  const active = hasActiveFilterValue(current)

  switch (definition.type) {
    case "text": {
      const typed = current?.type === "text" ? current : undefined
      const operator = defaultOperator(definition.operators, ["contains", "equals", "starts-with"], typed?.operator)
      return (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="border-dashed">
                <ListFilter className="size-4" />
                {title}
                {active ? <Badge variant="secondary" className="ml-1 rounded px-1 text-xs">1</Badge> : null}
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-64 space-y-2 p-2">
            <DropdownMenuLabel className="px-0 text-xs text-muted-foreground">
              {title}
            </DropdownMenuLabel>
            <OperatorSelect
              value={operator}
              options={filterOperators(definition.operators, ["contains", "equals", "starts-with"])}
              onChange={(next) =>
                setTypedFilter(filterColumn, {
                  type: "text",
                  operator: next as TextFilterOperator,
                  value: typed?.value ?? "",
                })
              }
            />
            <Input
              autoFocus
              value={typed?.value ?? ""}
              onChange={(event) =>
                setTypedFilter(filterColumn, {
                  type: "text",
                  operator,
                  value: event.target.value,
                })
              }
              placeholder="Value"
            />
            {active ? <DropdownMenuItem onClick={() => clearTypedFilter(filterColumn)}>Clear</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
    case "number":
    case "money": {
      const typed = current?.type === definition.type ? current : undefined
      const operator = defaultOperator(
        definition.operators,
        ["equals", "greater-than", "less-than", "between"],
        typed?.operator
      )
      const isBetween = operator === "between"
      const input = (field: "value" | "min" | "max", placeholder: string) => (
        <Input
          type="number"
          value={typed?.[field] == null ? "" : String(typed[field])}
          onChange={(event) => {
            const raw = event.target.value
            const nextValue = raw === "" ? undefined : Number(raw)
            setTypedFilter(filterColumn, {
              type: definition.type,
              operator,
              ...(field === "value" ? { value: nextValue } : { [field]: nextValue }),
              ...(field !== "value" && typed?.[field === "min" ? "max" : "min"] != null
                ? { [field === "min" ? "max" : "min"]: typed[field === "min" ? "max" : "min"] }
                : {}),
            } as DataTableFilterValue)
          }}
          placeholder={placeholder}
        />
      )
      return (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="border-dashed">
                <ListFilter className="size-4" />
                {title}
                {active ? <Badge variant="secondary" className="ml-1 rounded px-1 text-xs">1</Badge> : null}
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-64 space-y-2 p-2">
            <DropdownMenuLabel className="px-0 text-xs text-muted-foreground">
              {title}
            </DropdownMenuLabel>
            <OperatorSelect
              value={operator}
              options={filterOperators(definition.operators, ["equals", "greater-than", "less-than", "between"])}
              onChange={(next) =>
                setTypedFilter(filterColumn, {
                  type: definition.type,
                  operator: next as NumericFilterOperator,
                  ...(typed?.value != null ? { value: typed.value } : {}),
                  ...(typed?.min != null ? { min: typed.min } : {}),
                  ...(typed?.max != null ? { max: typed.max } : {}),
                })
              }
            />
            {isBetween ? (
              <div className="grid grid-cols-2 gap-2">
                {input("min", "Min")}
                {input("max", "Max")}
              </div>
            ) : (
              input("value", "Value")
            )}
            {active ? <DropdownMenuItem onClick={() => clearTypedFilter(filterColumn)}>Clear</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
    case "date": {
      const typed = current?.type === "date" ? current : undefined
      const operator = defaultOperator(definition.operators, ["on", "before", "after", "between"], typed?.operator)
      const isBetween = operator === "between"
      const dateInput = (field: "value" | "from" | "to", placeholder: string) => (
        <Input
          type="date"
          aria-label={placeholder}
          value={typed?.[field] ?? ""}
          onChange={(event) =>
            setTypedFilter(filterColumn, {
              type: "date",
              operator,
              ...(field === "value" ? { value: event.target.value } : { [field]: event.target.value }),
              ...(field !== "value" && typed?.[field === "from" ? "to" : "from"]
                ? { [field === "from" ? "to" : "from"]: typed[field === "from" ? "to" : "from"] }
                : {}),
            } as DataTableFilterValue)
          }
        />
      )
      return (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="border-dashed">
                <ListFilter className="size-4" />
                {title}
                {active ? <Badge variant="secondary" className="ml-1 rounded px-1 text-xs">1</Badge> : null}
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-64 space-y-2 p-2">
            <DropdownMenuLabel className="px-0 text-xs text-muted-foreground">
              {title}
            </DropdownMenuLabel>
            <OperatorSelect
              value={operator}
              options={filterOperators(definition.operators, ["on", "before", "after", "between"])}
              onChange={(next) =>
                setTypedFilter(filterColumn, {
                  type: "date",
                  operator: next as DateFilterOperator,
                  ...(typed?.value ? { value: typed.value } : {}),
                  ...(typed?.from ? { from: typed.from } : {}),
                  ...(typed?.to ? { to: typed.to } : {}),
                })
              }
            />
            {isBetween ? (
              <div className="grid grid-cols-2 gap-2">
                {dateInput("from", "From")}
                {dateInput("to", "To")}
              </div>
            ) : (
              dateInput("value", "Date")
            )}
            {active ? <DropdownMenuItem onClick={() => clearTypedFilter(filterColumn)}>Clear</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
    case "boolean": {
      const typed = current?.type === "boolean" ? current : undefined
      return (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="border-dashed">
                <ListFilter className="size-4" />
                {title}
                {active ? <Badge variant="secondary" className="ml-1 rounded px-1 text-xs">1</Badge> : null}
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-40 p-2">
            <DropdownMenuLabel className="px-0 text-xs text-muted-foreground">{title}</DropdownMenuLabel>
            <OperatorSelect
              value={typed?.value == null ? "any" : String(typed.value)}
              options={["any", "true", "false"]}
              onChange={(next) =>
                next === "any"
                  ? clearTypedFilter(filterColumn)
                  : setTypedFilter(filterColumn, { type: "boolean", value: next === "true" })
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
    case "enum":
    case "relation":
      return (
        <OptionFilter
          column={filterColumn}
          definition={definition}
          current={current}
          title={title}
          active={active}
        />
      )
  }
}

function OptionFilter({
  column,
  definition,
  current,
  title,
  active,
}: {
  column: FilterColumn
  definition: Extract<DataTableFilterDefinition, { type: "enum" | "relation" }>
  current: DataTableFilterValue | undefined
  title: string
  active: boolean
}) {
  const [query, setQuery] = React.useState("")
  const selected =
    current?.type === "enum"
      ? new Set(current.value ?? [])
      : current?.type === "relation"
        ? new Set(Array.isArray(current.value) ? current.value : current.value ? [current.value] : [])
        : new Set<string>()
  const options = (definition.options ?? []).filter((option) =>
    option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  )

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setTypedFilter(column, { type: definition.type, value: Array.from(next) })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="border-dashed">
            <ListFilter className="size-4" />
            {title}
            {active ? <Badge variant="secondary" className="ml-1 rounded px-1 text-xs">{selected.size}</Badge> : null}
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-auto p-2">
        <DropdownMenuLabel className="px-0 text-xs text-muted-foreground">{title}</DropdownMenuLabel>
        {definition.type === "relation" ? (
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="mb-2"
          />
        ) : null}
        {options.length === 0 ? (
          <div className="px-1 py-2 text-xs text-muted-foreground">No values</div>
        ) : (
          <DropdownMenuGroup>
            {options.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={selected.has(option.value)}
                onCheckedChange={() => toggle(option.value)}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        )}
        {active ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => clearTypedFilter(column)}>Clear</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FacetFilter<TData, TValue>({
  column,
  title,
}: {
  column: Column<TData, TValue>
  title: string
}) {
  const selected = new Set((column.getFilterValue() as string[]) ?? [])
  const options = Array.from(column.getFacetedUniqueValues().keys())
    .filter((v) => v != null && v !== "")
    .map((v) => String(v))
    .sort()

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    const arr = Array.from(next)
    column.setFilterValue(arr.length ? arr : undefined)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="border-dashed">
            <ListFilter className="size-4" />
            {title}
            {selected.size > 0 ? (
              <Badge variant="secondary" className="ml-1 rounded px-1 text-xs">
                {selected.size}
              </Badge>
            ) : null}
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="max-h-72 w-52 overflow-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground capitalize">
            {title}
          </DropdownMenuLabel>
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No values
            </div>
          ) : (
            options.map((value) => (
              <DropdownMenuCheckboxItem
                key={value}
                checked={selected.has(value)}
                onCheckedChange={() => toggle(value)}
                className="capitalize"
              >
                {value.replace(/_/g, " ")}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuGroup>
        {selected.size > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => column.setFilterValue(undefined)}>
              Clear
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Reusable sortable column header. Use as a column's `header`. */
export function SortableHeader({
  column,
  title,
  className,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  column: any
  title: string
  className?: string
}) {
  const sorted = column.getIsSorted() as "asc" | "desc" | false
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "-ml-2 h-7 data-[state=open]:bg-accent",
        sorted && "text-foreground",
        className
      )}
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {title}
      {sorted === "asc" ? (
        <ArrowUp className="ml-1 size-3.5" />
      ) : sorted === "desc" ? (
        <ArrowDown className="ml-1 size-3.5" />
      ) : (
        <ArrowUpDown className="ml-1 size-3.5 text-muted-foreground/60" />
      )}
    </Button>
  )
}

/* ------------------------------------------------------------------ */
/* Column-def factories for the cell shapes repeated across every      */
/* table: right-aligned money, and the primary-name record link.       */
/* ------------------------------------------------------------------ */

/** Right-aligned column header (pairs with moneyCell). */
export function rightHeader(title: string) {
  return function RightHeader() {
    return <div className="text-right">{title}</div>
  }
}

/** Right-aligned tabular money cell; em-dash when the amount is empty. */
export function moneyCell<TData>(
  amount: (row: TData) => string | number | null | undefined,
  currency: (row: TData) => string | null | undefined
) {
  return function MoneyCell({ row }: { row: { original: TData } }) {
    const value = amount(row.original)
    return (
      <div className="text-right tabular-nums">
        {value != null && value !== ""
          ? formatMoney(String(value), currency(row.original) ?? undefined)
          : "—"}
      </div>
    )
  }
}

/** Primary-name cell linking to the record's detail page. */
export function linkCell<TData>(
  href: (row: TData) => string,
  label: (row: TData) => React.ReactNode
) {
  return function LinkCell({ row }: { row: { original: TData } }) {
    return (
      <Link href={href(row.original)} className="font-medium link">
        {label(row.original)}
      </Link>
    )
  }
}
