"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Package, MoreHorizontal, Plus } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { DataTable, SortableHeader, linkCell } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { showActionError } from "@/lib/show-action-error"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { formatMoney } from "@/lib/format"
import { useOpenOnNewParam } from "@/hooks/use-open-on-new-param"
import { usePermissions } from "@/components/command-palette"
import { PERMISSIONS } from "@/lib/permissions"
import { ProductForm } from "./product-form"
import { deleteProduct, restoreProduct, type ProductRow } from "./actions"

type ProductCodeOption = { code: string; name: string }

function RowActions({
  product,
  productCodes,
  currencies,
}: {
  product: ProductRow
  productCodes: ProductCodeOption[]
  currencies: string[]
}) {
  const router = useRouter()
  const perms = usePermissions()
  const canUpdate = perms.has(PERMISSIONS.PRODUCT_UPDATE)
  const canDelete = perms.has(PERMISSIONS.PRODUCT_DELETE)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)

  async function onDelete() {
    const res = await deleteProduct(product.id)
    if (!res.ok) {
      showActionError(res)
      setConfirmOpen(false)
      return
    }
    toast.success("Product deleted", {
      action: {
        label: "Undo",
        onClick: async () => {
          const r = await restoreProduct(product.id)
          if (!r.ok) {
            showActionError(r)
            return
          }
          toast.success("Product restored")
          router.refresh()
        },
      },
    })
    router.refresh()
    setConfirmOpen(false)
  }

  return (
    <div className="flex justify-end">
      {canUpdate ? (
        <ProductForm
          product={product}
          productCodes={productCodes}
          currencies={currencies}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={() => {
            setEditOpen(false)
            router.refresh()
          }}
        />
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm">
              <MoreHorizontal className="size-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem nativeButton={false} render={<Link href={`/products/${product.id}`} />}>
            View
          </DropdownMenuItem>
          {canUpdate ? (
            <DropdownMenuItem onClick={() => setEditOpen(true)}>Edit</DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
                Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              This soft-deletes “{product.name}”. Existing quotation lines that
              referenced it keep their copied description and price. You can undo
              this right after.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function ProductsTable({
  data,
  productCodes,
  currencies,
}: {
  data: ProductRow[]
  productCodes: ProductCodeOption[]
  currencies: string[]
}) {
  const router = useRouter()
  const perms = usePermissions()
  const canCreate = perms.has(PERMISSIONS.PRODUCT_CREATE)
  const [newOpen, setNewOpen] = React.useState(false)
  useOpenOnNewParam(() => setNewOpen(true))

  const codeName = React.useMemo(
    () => new Map(productCodes.map((c) => [c.code, c.name])),
    [productCodes]
  )

  const columns = React.useMemo<ColumnDef<ProductRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: linkCell(
          (r) => `/products/${r.id}`,
          (r) => r.name
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) =>
          row.original.description ? (
            <span className="text-muted-foreground line-clamp-1">
              {row.original.description}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "productCode",
        header: "Product code",
        cell: ({ row }) =>
          row.original.productCode ? (
            <span>
              <span className="font-mono text-xs">{row.original.productCode}</span>
              {codeName.get(row.original.productCode) ? (
                <span className="text-muted-foreground">
                  {" "}· {codeName.get(row.original.productCode)}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "subcategory",
        header: "Subcategory",
        cell: ({ row }) => row.original.subcategory ?? "—",
      },
      {
        accessorKey: "uom",
        header: "UOM",
        cell: ({ row }) => row.original.uom ?? "—",
      },
      {
        accessorKey: "standardPrice",
        header: ({ column }) => (
          <SortableHeader column={column} title="Standard price" />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatMoney(row.original.standardPrice, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: "isActive",
        header: "Status",
        cell: ({ row }) =>
          row.original.isActive ? (
            <Badge variant="secondary">Active</Badge>
          ) : (
            <Badge variant="outline">Inactive</Badge>
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <RowActions
            product={row.original}
            productCodes={productCodes}
            currencies={currencies}
          />
        ),
        enableHiding: false,
      },
    ],
    [productCodes, codeName, currencies]
  )

  return (
    <DataTable
      columns={columns}
      data={data}
      tableId="products"
      cap={1000}
      filters={[
        { type: "relation", columnId: "productCode", title: "Product code", options: productCodes.map((option) => ({ value: option.code, label: option.name })) },
        { type: "boolean", columnId: "isActive", title: "Status" },
      ]}
      searchColumn="name"
      searchPlaceholder="Search products…"
      emptyIcon={Package}
      emptyMessage="No products yet"
      emptyDescription="Add a standardised product so quotations can pick from it."
      emptyAction={
        canCreate ? (
          <ProductForm
            productCodes={productCodes}
            currencies={currencies}
            trigger={
              <Button size="sm">
                <Plus className="size-4" />
                New product
              </Button>
            }
            onSaved={() => router.refresh()}
          />
        ) : undefined
      }
      toolbar={
        canCreate ? (
          <ProductForm
            productCodes={productCodes}
            currencies={currencies}
            open={newOpen}
            onOpenChange={setNewOpen}
            trigger={
              <Button size="sm">
                <Plus className="size-4" />
                New product
              </Button>
            }
            onSaved={() => router.refresh()}
          />
        ) : undefined
      }
    />
  )
}
