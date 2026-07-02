"use client"

import * as React from "react"
import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Combobox } from "@/components/ui/combobox"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { formatMoney } from "@/lib/format"
import { toDateString } from "@/lib/dates"
import {
  quotationLineSchema,
  headerDiscountSchema,
} from "@/lib/validation-quotation"
import { computeQuotation } from "@/server/services/quotation-math"
import type { ProductOption } from "@/lib/lookups"
import { createQuotation, type QuotationRow, type TaxOption } from "./actions"

const NO_TAX = "__none__"
/** Sentinel: leave project nature to the funnel's default (server inherits it). */
const INHERIT_PROJECT_NATURE = "__inherit__"
/** Sentinel: a line with no nature of its own (falls under the quote's). */
const NO_LINE_NATURE = "__none__"
/** Sentinel: a free-text line with no linked product. */
const NO_PRODUCT = "__custom__"

const schema = z.object({
  opportunityId: z.string().trim().min(1, "Select a funnel"),
  taxSettingId: z.string(),
  projectNatureCode: z.string(),
  validUntil: z.string(),
  notes: z.string(),
  headerDiscount: headerDiscountSchema,
  lines: z.array(quotationLineSchema).min(1, "Add at least one line item"),
})

type FormValues = z.infer<typeof schema>

export type OpportunityOption = { id: string; name: string }
export type ProjectNatureOption = { code: string; name: string }

/**
 * Shared quotation CREATE form with the full line-item table. Rendered on the
 * `/quotations/new` page (reached from the Quotations list and the funnel's
 * "New quotation", the latter passing `?opportunityId=` to pre-bind the funnel).
 * When `opportunityId` is fixed the funnel picker is hidden and bound.
 */
export function QuotationCreateForm({
  taxOptions,
  taxInclusive,
  projectNatures = [],
  products = [],
  opportunities,
  opportunityId,
  defaultOpportunityId,
  currency = "MYR",
  defaultValidUntil,
  submitLabel = "Create quotation",
  onCancel,
  onCreated,
}: {
  taxOptions: TaxOption[]
  taxInclusive: boolean
  /** Tenant project-nature picklist; empty hides the picker. */
  projectNatures?: ProjectNatureOption[]
  /** Active catalog products for the line-item picker. */
  products?: ProductOption[]
  /** Picker options. Omit/empty when `opportunityId` is fixed. */
  opportunities?: OpportunityOption[]
  /** Pre-bound funnel; when set the picker is hidden. */
  opportunityId?: string
  /** Pre-selected funnel in the picker (picker stays visible/editable). */
  defaultOpportunityId?: string
  currency?: string
  /** Prefill for "Valid until" (tenant default validity), YYYY-MM-DD. */
  defaultValidUntil?: string | null
  submitLabel?: string
  onCancel?: () => void
  onCreated?: (quotation: QuotationRow) => void
}) {
  const fixedOpportunity = !!opportunityId
  const [busy, setBusy] = React.useState(false)

  const defaultTaxId =
    taxOptions.find((t) => t.isDefault)?.id ?? NO_TAX

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: {
      opportunityId: opportunityId ?? defaultOpportunityId ?? "",
      taxSettingId: defaultTaxId,
      projectNatureCode: INHERIT_PROJECT_NATURE,
      validUntil: defaultValidUntil ?? "",
      notes: "",
      headerDiscount: "0",
      lines: [
        {
          productId: "",
          projectNatureCode: "",
          uom: "",
          description: "",
          quantity: "1",
          unitPrice: "0",
          discountAmount: "0",
        },
      ],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  })

  // Product picker items + a helper that fills a line from the chosen product.
  const productItems = React.useMemo(
    () => [
      { value: NO_PRODUCT, label: "Custom line (no product)" },
      ...products.map((p) => ({ value: p.id, label: p.name })),
    ],
    [products]
  )
  const applyProduct = React.useCallback(
    (index: number, productId: string) => {
      if (productId === NO_PRODUCT) {
        form.setValue(`lines.${index}.productId`, "")
        return
      }
      const p = products.find((x) => x.id === productId)
      if (!p) return
      form.setValue(`lines.${index}.productId`, p.id)
      form.setValue(`lines.${index}.description`, p.description || p.name, {
        shouldValidate: true,
      })
      form.setValue(
        `lines.${index}.unitPrice`,
        Number(p.standardPrice).toString(),
        { shouldValidate: true }
      )
      form.setValue(`lines.${index}.uom`, p.uom ?? "")
    },
    [products, form]
  )

  const watchedLines = useWatch({ control: form.control, name: "lines" })
  const watchedTaxId = useWatch({ control: form.control, name: "taxSettingId" })
  const watchedDiscount = useWatch({
    control: form.control,
    name: "headerDiscount",
  })
  const ratePercent =
    watchedTaxId && watchedTaxId !== NO_TAX
      ? taxOptions.find((t) => t.id === watchedTaxId)?.ratePercent ?? "0"
      : "0"

  const totals = React.useMemo(
    () =>
      computeQuotation({
        lines: (watchedLines ?? []).map((l) => ({
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountAmount: l.discountAmount,
        })),
        ratePercent,
        headerDiscount: watchedDiscount || "0",
        taxInclusive,
      }),
    [watchedLines, ratePercent, watchedDiscount, taxInclusive]
  )

  async function onSubmit(values: FormValues) {
    setBusy(true)
    const res = await createQuotation({
      opportunityId: values.opportunityId,
      taxSettingId:
        values.taxSettingId === NO_TAX ? null : values.taxSettingId,
      projectNatureCode:
        values.projectNatureCode === INHERIT_PROJECT_NATURE
          ? null
          : values.projectNatureCode,
      validUntil: values.validUntil || null,
      notes: values.notes || null,
      headerDiscount: values.headerDiscount || "0",
      lines: values.lines.map((l) => ({
        productId: l.productId || null,
        projectNatureCode: l.projectNatureCode || null,
        uom: l.uom || null,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountAmount: l.discountAmount || "0",
      })),
    })
    if (!res.ok) {
      toast.error(res.error)
      setBusy(false)
      return
    }
    toast.success("Quotation created")
    onCreated?.(res.data)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {!fixedOpportunity ? (
            <FormField
              control={form.control}
              name="opportunityId"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel required>Funnel</FormLabel>
                  <FormControl>
                    <Combobox
                      value={field.value}
                      onChange={field.onChange}
                      options={(opportunities ?? []).map((o) => ({
                        value: o.id,
                        label: o.name,
                      }))}
                      placeholder="Select a funnel…"
                      searchPlaceholder="Search funnels…"
                      emptyMessage="No funnels found."
                      aria-invalid={!!fieldState.error}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}

          <FormField
            control={form.control}
            name="taxSettingId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tax setting</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(v) => field.onChange(v ?? NO_TAX)}
                  items={[
                    { value: NO_TAX, label: "No tax" },
                    ...taxOptions.map((t) => ({
                      value: t.id,
                      label: `${t.name} (${Number(t.ratePercent).toFixed(2)}%)`,
                    })),
                  ]}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="No tax" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NO_TAX}>No tax</SelectItem>
                    {taxOptions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({Number(t.ratePercent).toFixed(2)}%)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {projectNatures.length > 0 ? (
            <FormField
              control={form.control}
              name="projectNatureCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project nature</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) =>
                      field.onChange(v ?? INHERIT_PROJECT_NATURE)
                    }
                    items={[
                      {
                        value: INHERIT_PROJECT_NATURE,
                        label: "Use funnel default",
                      },
                      ...projectNatures.map((p) => ({
                        value: p.code,
                        label: p.name,
                      })),
                    ]}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Use funnel default" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={INHERIT_PROJECT_NATURE}>
                        Use funnel default
                      </SelectItem>
                      {projectNatures.map((p) => (
                        <SelectItem key={p.code} value={p.code}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}

          <FormField
            control={form.control}
            name="validUntil"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Valid until</FormLabel>
                <FormControl>
                  <Input type="date" min={toDateString()} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="headerDiscount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Header discount ({currency})</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" min="0" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Notes</FormLabel>
                <FormControl>
                  <Textarea
                    rows={2}
                    placeholder="Optional notes for the customer…"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <FormLabel>Line items</FormLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                append({
                  productId: "",
                  projectNatureCode: "",
                  uom: "",
                  description: "",
                  quantity: "1",
                  unitPrice: "0",
                  discountAmount: "0",
                })
              }
            >
              <Plus /> Add line
            </Button>
          </div>
          {form.formState.errors.lines?.root ? (
            <p className="text-sm text-destructive">
              {form.formState.errors.lines.root.message}
            </p>
          ) : null}
          {fields.map((f, i) => {
            const line = totals.lines[i]
            return (
              <div key={f.id} className="grid gap-3 rounded-lg border p-3">
                {products.length > 0 ? (
                  <FormField
                    control={form.control}
                    name={`lines.${i}.productId`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Product</FormLabel>
                        <FormControl>
                          <Combobox
                            value={field.value || NO_PRODUCT}
                            onChange={(v) => applyProduct(i, v || NO_PRODUCT)}
                            options={productItems}
                            placeholder="Pick a product…"
                            searchPlaceholder="Search products…"
                            emptyMessage="No products found."
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
                {projectNatures.length > 0 ? (
                  <FormField
                    control={form.control}
                    name={`lines.${i}.projectNatureCode`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">
                          Project nature (this line)
                        </FormLabel>
                        <FormControl>
                          <Combobox
                            value={field.value || NO_LINE_NATURE}
                            onChange={(v) =>
                              field.onChange(
                                !v || v === NO_LINE_NATURE ? "" : v
                              )
                            }
                            options={[
                              {
                                value: NO_LINE_NATURE,
                                label: "— (quote default)",
                              },
                              ...projectNatures.map((p) => ({
                                value: p.code,
                                label: p.name,
                              })),
                            ]}
                            placeholder="Nature…"
                            searchPlaceholder="Search natures…"
                            emptyMessage="No natures found."
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
                <FormField
                  control={form.control}
                  name={`lines.${i}.description`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs" required>
                        Description
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Service description" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <FormField
                    control={form.control}
                    name={`lines.${i}.quantity`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs" required>
                          Qty
                        </FormLabel>
                        <FormControl>
                          <Input type="number" step="0.001" min="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`lines.${i}.unitPrice`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs" required>
                          Unit price
                        </FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" min="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`lines.${i}.discountAmount`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Discount ({currency})</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" min="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-2">
                    <FormLabel className="text-xs">Line total</FormLabel>
                    <div className="flex h-8 items-center text-sm tabular-nums">
                      {formatMoney(line?.lineTotal ?? 0, currency)}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={fields.length === 1}
                    onClick={() => remove(i)}
                  >
                    <Trash2 /> Remove
                  </Button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="grid gap-2 rounded-lg border p-3 text-sm">
          <Row label="Subtotal" value={formatMoney(totals.subtotal, currency)} />
          <Row
            label="Discount"
            value={formatMoney(totals.discountTotal, currency)}
          />
          <Row
            label={`Tax${taxInclusive ? " (incl.)" : ""} (${Number(
              ratePercent
            ).toFixed(2)}%)`}
            value={formatMoney(totals.taxTotal, currency)}
          />
          <Separator className="my-1" />
          <div className="flex items-center justify-between font-medium">
            <span>Total</span>
            <span className="tabular-nums">
              {formatMoney(totals.total, currency)}
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  )
}
