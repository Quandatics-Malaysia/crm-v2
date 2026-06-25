"use client"

import * as React from "react"
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
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
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  SlidersHorizontal,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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
  emptyMessage?: string
  toolbar?: React.ReactNode
  pageSize?: number
  /** Columns to expose as multi-select faceted filters. */
  facets?: DataTableFacet[]
  /** Stable id to persist filter/sort/visibility + named saved views in localStorage. */
  tableId?: string
}

type SavedView = {
  name: string
  filters: ColumnFiltersState
  sorting: SortingState
  visibility: VisibilityState
}

const facetFilterFn = (
  row: { getValue: (id: string) => unknown },
  id: string,
  value: string[]
) => !value?.length || value.includes(String(row.getValue(id)))

export function DataTable<TData, TValue>({
  columns,
  data,
  searchColumn,
  searchPlaceholder = "Search…",
  emptyMessage = "No results.",
  toolbar,
  pageSize = 10,
  facets,
  tableId,
}: DataTableProps<TData, TValue>) {
  const facetIds = React.useMemo(
    () => new Set((facets ?? []).map((f) => f.columnId)),
    [facets]
  )

  // inject a faceted filterFn for facet columns so multi-select arrays work
  const tableColumns = React.useMemo(
    () =>
      columns.map((c) => {
        const id = (c as { id?: string; accessorKey?: string }).id ??
          (c as { accessorKey?: string }).accessorKey
        return id && facetIds.has(id) ? { ...c, filterFn: facetFilterFn } : c
      }),
    [columns, facetIds]
  )

  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState({})
  const [views, setViews] = React.useState<SavedView[]>([])

  // restore persisted state + saved views
  React.useEffect(() => {
    if (!tableId) return
    try {
      const raw = localStorage.getItem(`crm-table:${tableId}`)
      if (raw) {
        const s = JSON.parse(raw)
        if (s.filters) setColumnFilters(s.filters)
        if (s.sorting) setSorting(s.sorting)
        if (s.visibility) setColumnVisibility(s.visibility)
      }
      const v = localStorage.getItem(`crm-views:${tableId}`)
      if (v) setViews(JSON.parse(v))
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId])

  // persist current state
  React.useEffect(() => {
    if (!tableId) return
    try {
      localStorage.setItem(
        `crm-table:${tableId}`,
        JSON.stringify({ filters: columnFilters, sorting, visibility: columnVisibility })
      )
    } catch {
      // ignore
    }
  }, [tableId, columnFilters, sorting, columnVisibility])

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: { sorting, columnFilters, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    initialState: { pagination: { pageSize } },
  })

  const searchCol = searchColumn ? table.getColumn(searchColumn) : undefined
  const hasActiveFilters = columnFilters.length > 0

  function saveView() {
    if (!tableId) return
    const name = window.prompt("Save current view as:")?.trim()
    if (!name) return
    const next = [
      ...views.filter((v) => v.name !== name),
      { name, filters: columnFilters, sorting, visibility: columnVisibility },
    ]
    setViews(next)
    try {
      localStorage.setItem(`crm-views:${tableId}`, JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  function applyView(v: SavedView) {
    setColumnFilters(v.filters)
    setSorting(v.sorting)
    setColumnVisibility(v.visibility)
  }

  function deleteView(name: string) {
    const next = views.filter((v) => v.name !== name)
    setViews(next)
    if (tableId) {
      try {
        localStorage.setItem(`crm-views:${tableId}`, JSON.stringify(next))
      } catch {
        // ignore
      }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {searchCol ? (
          <Input
            placeholder={searchPlaceholder}
            value={(searchCol.getFilterValue() as string) ?? ""}
            onChange={(e) => searchCol.setFilterValue(e.target.value)}
            className="max-w-xs"
          />
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
            onClick={() => setColumnFilters([])}
            className="text-muted-foreground"
          >
            <X className="size-4" /> Reset
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          {tableId ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm">
                    <ListFilter className="size-4" />
                    <span className="hidden sm:inline">Views</span>
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Saved views
                </DropdownMenuLabel>
                {views.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    None yet
                  </div>
                ) : (
                  views.map((v) => (
                    <DropdownMenuItem
                      key={v.name}
                      onClick={() => applyView(v)}
                      className="justify-between"
                    >
                      <span className="truncate">{v.name}</span>
                      <X
                        className="size-3.5 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteView(v.name)
                        }}
                      />
                    </DropdownMenuItem>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={saveView}>
                  Save current view…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm">
                  <SlidersHorizontal className="size-4" />
                  <span className="hidden sm:inline">Columns</span>
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-44">
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

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
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} row(s)
        </span>
        <div className="flex items-center gap-2">
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
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("-ml-2 h-7 data-[state=open]:bg-accent", className)}
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {title}
      <ArrowUpDown className="ml-1 size-3.5" />
    </Button>
  )
}
