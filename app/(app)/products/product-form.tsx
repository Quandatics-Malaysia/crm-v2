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
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Combobox } from "@/components/ui/combobox"
import { createProduct, updateProduct, type ProductRow } from "./actions"

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

function defaults(product?: ProductRow): FormValues {
  return {
    name: product?.name ?? "",
    productCode: product?.productCode ?? NONE,
    subcategory: product?.subcategory ?? "",
    uom: product?.uom ?? "",
    currency: product?.currency ?? "MYR",
    standardPrice: product?.standardPrice ?? "0",
    description: product?.description ?? "",
    isActive: product?.isActive ?? true,
  }
}

export function ProductForm({
  product,
  productCodes,
  trigger,
  open: controlledOpen,
  onOpenChange,
  onSaved,
}: {
  product?: ProductRow
  /** Tenant product-code picklist (code + name). */
  productCodes: { code: string; name: string }[]
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSaved?: () => void
}) {
  const [open, setOpen] = useDialogOpen(controlledOpen, onOpenChange)
  const editing = !!product

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults(product),
  })

  React.useEffect(() => {
    if (open) form.reset(defaults(product))
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

  async function onSubmit(values: FormValues) {
    const payload = {
      name: values.name,
      productCode:
        values.productCode && values.productCode !== NONE
          ? values.productCode
          : null,
      subcategory: values.subcategory || null,
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit product" : "New product"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid max-h-[70vh] gap-4 overflow-y-auto px-1"
          >
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

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="productCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product code</FormLabel>
                    <FormControl>
                      <Combobox
                        value={field.value}
                        onChange={(v) => field.onChange(v || NONE)}
                        options={codeItems}
                        placeholder="Select a product line"
                        searchPlaceholder="Search codes…"
                        emptyMessage="No product codes. Add them in Settings."
                      />
                    </FormControl>
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
                    <FormControl>
                      <Input placeholder="Data Analytics" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                    <FormControl>
                      <Input placeholder="MYR" maxLength={3} className="uppercase" {...field} />
                    </FormControl>
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

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="HRDF Claimable RM10,500"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div className="grid gap-0.5">
                    <FormLabel>Active</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Inactive products are hidden from the quotation picker.
                    </p>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-2">
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
