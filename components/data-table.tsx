"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EmptyState } from "@/components/empty-state"
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
  /** Columns to expose as multi-select faceted filters. */
  facets?: DataTableFacet[]
  /** Namespaces the URL state params so multiple tables can coexist on a page. */
  tableId?: string
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
  facets,
  tableId,
  cap,
}: DataTableProps<TData, TValue>) {
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
        return id && facetIds.has(id) ? { ...c, filterFn: facetFilterFn } : c
      }),
    [columns, facetIds]
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
    for (const f of facets ?? []) {
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
      const fv = columnFilters.find((c) => c.id === f.columnId)?.value as
        | string[]
        | undefined
      if (fv && fv.length) params.set(key(`f_${f.columnId}`), fv.join(","))
      else params.delete(key(`f_${f.columnId}`))
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

        {(facets ?? []).map((f) => {
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
