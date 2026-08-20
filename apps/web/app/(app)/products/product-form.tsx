"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { showActionError } from "@/lib/show-action-error"
import { useDialogOpen } from "@/components/use-dialog-open"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createProduct, updateProduct, type ProductRow } from "./actions"
import { DEFAULT_CURRENCIES } from "@/lib/tenant-defaults"
import type { ProductCategory } from "@/app/(app)/settings/constants"

const NONE = "__none__"

const schema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  productCode: z.string().optional(),
  subcategory: z.string().optional(),
  uom: z.string().optional(),
  currency: z
    .string()
    .trim()
    .min(1, "Required")
    .max(3, "3-letter code")
    .regex(/^[A-Za-z]{3}$/, "3-letter code"),
  standardPrice: z
    .string()
    .refine((v) => v === "" || Number(v) >= 0, "Enter a valid price"),
  description: z.string().optional(),
  isActive: z.boolean(),
})

type FormValues = z.infer<typeof schema>

function defaults(product?: ProductRow, currencies: string[] = DEFAULT_CURRENCIES): FormValues {
  return {
    name: product?.name ?? "",
    productCode: product?.productCode ?? NONE,
    subcategory: product?.subcategory ?? "",
    uom: product?.uom ?? "",
    currency: product?.currency ?? currencies[0] ?? "MYR",
    standardPrice: product?.standardPrice ?? "0",
    description: product?.description ?? "",
    isActive: product?.isActive ?? true,
  }
}

export function ProductForm({
  product,
  productCodes,
  currencies = DEFAULT_CURRENCIES,
  trigger,
  open: controlledOpen,
  onOpenChange,
  onSaved,
}: {
  product?: ProductRow
  /** Tenant product taxonomy (category + dependent subcategories). */
  productCodes: ProductCategory[]
  /** Tenant currency picklist (Settings → General); first = default. */
  currencies?: string[]
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSaved?: () => void
}) {
  const [open, setOpen] = useDialogOpen(controlledOpen, onOpenChange)
  const editing = !!product

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults(product, currencies),
  })
  const selectedProductCode = form.watch("productCode")

  React.useEffect(() => {
    if (open) form.reset(defaults(product, currencies))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Include the product's stored code even if it's no longer in the picklist so
  // a stale value stays selectable.
  const codeItems = React.useMemo(() => {
    const items = [
      { value: NONE, label: "None" },
      ...productCodes.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })),
    ]
    const current = product?.productCode
    if (current && !items.some((c) => c.value === current))
      items.push({ value: current, label: current })
    return items
  }, [productCodes, product?.productCode])

  const subcategoryItems = React.useMemo(() => {
    const category = productCodes.find((candidate) => candidate.code === selectedProductCode)
    const items = [
      { value: NONE, label: "None" },
      ...(category?.subcategories ?? []).map((subcategory) => ({
        value: subcategory.code,
        label: `${subcategory.code} · ${subcategory.name}`,
      })),
    ]
    const current = product?.subcategory
    if (current && !items.some((item) => item.value === current)) {
      items.push({ value: current, label: current })
    }
    return items
  }, [productCodes, product?.subcategory, selectedProductCode])

  // Include the product's stored currency even if it's no longer in the
  // tenant picklist so a stale value stays selectable.
  const currencyItems = React.useMemo(() => {
    const current = product?.currency
    if (current && !currencies.includes(current)) return [...currencies, current]
    return currencies
  }, [currencies, product?.currency])

  async function onSubmit(values: FormValues) {
    const payload = {
      name: values.name,
      productCode:
        values.productCode && values.productCode !== NONE
          ? values.productCode
          : null,
      subcategory:
        values.subcategory && values.subcategory !== NONE
          ? values.subcategory
          : null,
      uom: values.uom || null,
      currency: values.currency.toUpperCase(),
      standardPrice: values.standardPrice || "0",
      description: values.description || null,
      isActive: values.isActive,
    }
    const res = editing
      ? await updateProduct(product!.id, payload)
      : await createProduct(payload)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success(editing ? "Product updated" : "Product created")
    setOpen(false)
    onSaved?.()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger as React.ReactElement} /> : null}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit product" : "New product"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid max-h-[75vh] gap-4 overflow-y-auto px-1"
          >
            <section className="grid gap-4 rounded-lg border bg-muted/20 p-4">
              <h3 className="text-base font-medium">Basics</h3>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Product name</FormLabel>
                    <FormControl>
                      <Input placeholder="Coaching – Business Intelligence" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>

            <section className="grid gap-4 rounded-lg border bg-muted/20 p-4">
              <h3 className="text-base font-medium">Classification</h3>
              <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="productCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product category</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value || NONE)
                        form.setValue("subcategory", NONE, { shouldDirty: true })
                      }}
                      items={codeItems}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a product category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {codeItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="subcategory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subcategory</FormLabel>
                    <Select
                      value={field.value || NONE}
                      onValueChange={field.onChange}
                      items={subcategoryItems}
                      disabled={subcategoryItems.length === 1}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a subcategory" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {subcategoryItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </div>
            </section>

            <section className="grid gap-4 rounded-lg border bg-muted/20 p-4">
              <h3 className="text-base font-medium">Pricing</h3>
              <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="uom"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>UOM</FormLabel>
                    <FormControl>
                      <Input placeholder="Day" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Currency</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      items={currencyItems.map((c) => ({ value: c, label: c }))}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Pick a currency…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {currencyItems.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="standardPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Standard price</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </div>
            </section>

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border bg-muted/20 p-4">
                  <div>
                    <FormLabel>Active</FormLabel>
                  </div>
                  <FormControl>
                    <Switch
                      className="w-8 shrink-0"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {editing ? "Save" : "Create product"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
