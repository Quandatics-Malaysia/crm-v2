"use client"

import * as React from "react"
import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { showActionError } from "@/lib/show-action-error"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
/** Sentinel: a free-text line with no linked product. */
const NO_PRODUCT = "__custom__"

const schema = z.object({
  funnelId: z.string().trim().min(1, "Select a funnel"),
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
 * "New quotation", the latter passing `?funnelId=` to pre-bind the funnel).
 * When `funnelId` is fixed the funnel picker is hidden and bound.
 */
export function QuotationCreateForm({
  taxOptions,
  taxInclusive,
  projectNatures = [],
  products = [],
  funnels,
  funnelId,
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
  /** Picker options. Omit/empty when `funnelId` is fixed. */
  funnels?: OpportunityOption[]
  /** Pre-bound funnel; when set the picker is hidden. */
  funnelId?: string
  /** Pre-selected funnel in the picker (picker stays visible/editable). */
  defaultOpportunityId?: string
  currency?: string
  /** Prefill for "Valid until" (tenant default validity), YYYY-MM-DD. */
  defaultValidUntil?: string | null
  submitLabel?: string
  onCancel?: () => void
  onCreated?: (quotation: QuotationRow) => void
}) {
  const fixedOpportunity = !!funnelId
  const [busy, setBusy] = React.useState(false)

  const defaultTaxId =
    taxOptions.find((t) => t.isDefault)?.id ?? NO_TAX

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: {
      funnelId: funnelId ?? defaultOpportunityId ?? "",
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
      funnelId: values.funnelId,
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
      showActionError(res)
      setBusy(false)
      return
    }
    toast.success("Quotation created")
    onCreated?.(res.data)
  }

  return (
    <Form {...form}>
      {/* Record-page anatomy (same as the quotation detail): wide left column
          for details + the line table, right rail for totals + actions. */}
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid items-start gap-6 lg:grid-cols-4"
      >
        <div className="grid min-w-0 gap-6 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
          {!fixedOpportunity ? (
            <FormField
              control={form.control}
              name="funnelId"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel required>Funnel</FormLabel>
                  <FormControl>
                    <Combobox
                      value={field.value}
                      onChange={field.onChange}
                      options={(funnels ?? []).map((o) => ({
                        value: o.id,
                        label: o.name,
                      }))}
                      placeholder="Select a funnel…"
                      searchPlaceholder="Search pipelines…"
                      emptyMessage="No pipelines found."
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line items</CardTitle>
              <CardAction>
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
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-3">
          {form.formState.errors.lines?.root ? (
            <p className="text-sm text-destructive">
              {form.formState.errors.lines.root.message}
            </p>
          ) : null}
          {/* Line-to-line billing table — same anatomy as the quotation edit
              page, with unit price editable for custom lines. */}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="w-8 py-2 pr-2 pl-2 font-medium">#</th>
                  {products.length > 0 ? (
                    <th className="py-2 pr-2 font-medium">Product</th>
                  ) : null}
                  <th className="py-2 pr-2 font-medium">Description</th>
                  <th className="w-20 py-2 pr-2 text-right font-medium">Qty</th>
                  <th className="w-14 py-2 pr-2 font-medium">UOM</th>
                  <th className="w-28 py-2 pr-2 text-right font-medium">
                    Unit price
                  </th>
                  <th className="w-28 py-2 pr-2 text-right font-medium">
                    Disc ({currency})
                  </th>
                  <th className="w-28 py-2 pr-2 text-right font-medium">
                    Line total
                  </th>
                  <th className="w-8 py-2 pr-2" />
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => {
                  const line = totals.lines[i]
                  const watched = watchedLines?.[i]
                  return (
                    <tr key={f.id} className="border-b align-middle last:border-0">
                      <td className="py-1.5 pr-2 pl-2 text-muted-foreground tabular-nums">
                        {i + 1}
                      </td>
                      {products.length > 0 ? (
                        <td className="py-1.5 pr-2">
                          <Combobox
                            value={watched?.productId || NO_PRODUCT}
                            onChange={(v) => applyProduct(i, v || NO_PRODUCT)}
                            options={productItems}
                            placeholder="Pick a product…"
                            searchPlaceholder="Search products…"
                            emptyMessage="No products found."
                            className="min-w-44"
                          />
                        </td>
                      ) : null}
                      <td className="py-1.5 pr-2">
                        <Input
                          className="min-w-44"
                          placeholder="Service description"
                          {...form.register(`lines.${i}.description`)}
                        />
                        {form.formState.errors.lines?.[i]?.description ? (
                          <p className="mt-0.5 text-xs text-destructive">
                            Required
                          </p>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-2">
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          className="w-20 text-right tabular-nums"
                          {...form.register(`lines.${i}.quantity`)}
                        />
                      </td>
                      <td className="py-1.5 pr-2 text-muted-foreground">
                        {watched?.uom || "—"}
                      </td>
                      <td className="py-1.5 pr-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-26 text-right tabular-nums"
                          {...form.register(`lines.${i}.unitPrice`)}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-24 text-right tabular-nums"
                          {...form.register(`lines.${i}.discountAmount`)}
                        />
                      </td>
                      <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
                        {formatMoney(line?.lineTotal ?? 0, currency)}
                      </td>
                      <td className="py-1.5 pr-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={fields.length === 1}
                          onClick={() => remove(i)}
                          aria-label="Remove line"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
            </CardContent>
          </Card>
        </div>

        {/* Right rail: live totals + actions, like the detail page sidebar. */}
        <div className="grid h-fit min-w-0 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <Row
                label="Subtotal"
                value={formatMoney(totals.subtotal, currency)}
              />
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
            </CardContent>
          </Card>

          <div className="grid gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : submitLabel}
            </Button>
            {onCancel ? (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
          </div>
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
