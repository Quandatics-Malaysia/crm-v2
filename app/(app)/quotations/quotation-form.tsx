"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Plus, Trash2, HelpCircleIcon, PrinterIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Combobox } from "@/components/ui/combobox"
import { Badge } from "@/components/ui/badge"
import type { ProductOption } from "@/lib/lookups"
import { StatusBadge } from "@/components/status-badge"
import { RelatedQuickLinks } from "@/components/object-tile"
import { Separator } from "@/components/ui/separator"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatMoney, formatDate } from "@/lib/format"
import type { ActionResult } from "@/lib/action-result"
import {
  quotationLineSchema,
  headerDiscountSchema,
} from "@/lib/validation-quotation"
import { computeQuotation } from "@/server/services/quotation-math"
import {
  updateQuotation,
  sendQuotation,
  acceptQuotation,
  rejectQuotation,
  setPrimaryQuotation,
  deleteQuotation,
  type QuotationDetail,
} from "./actions"

const schema = z.object({
  taxSettingId: z.string(),
  projectNatureCode: z.string(),
  validUntil: z.string(),
  notes: z.string(),
  headerDiscount: headerDiscountSchema,
  lines: z.array(quotationLineSchema).min(1, "Add at least one line item"),
})

type FormValues = z.infer<typeof schema>

const NO_TAX = "__none__"
/** Sentinel for "no project nature" in the editable picker. */
const NO_PROJECT_NATURE = "__none__"

type TaxOption = { id: string; name: string; ratePercent: string; isDefault: boolean }
type ProjectNatureOption = { code: string; name: string }

/** Per-affordance permission gates for the quotation actions. Defaults to fully
 * permitted so the component stays drop-in for any caller that omits them. */
export type QuotationPerms = {
  canUpdate: boolean
  canSend: boolean
  canAccept: boolean
  canDelete: boolean
  canCreateProject: boolean
}

const ALL_QUOTATION_PERMS: QuotationPerms = {
  canUpdate: true,
  canSend: true,
  canAccept: true,
  canDelete: true,
  canCreateProject: true,
}

export function QuotationForm({
  detail,
  taxOptions,
  taxInclusive,
  projectNatures = [],
  products = [],
  project = null,
  perms = ALL_QUOTATION_PERMS,
}: {
  detail: QuotationDetail
  taxOptions: TaxOption[]
  taxInclusive: boolean
  /** Tenant project-nature picklist; empty hides the picker. */
  projectNatures?: ProjectNatureOption[]
  /** Active catalog products for the line-item picker. */
  products?: ProductOption[]
  /** The delivery project created from this quotation, if any. */
  project?: { id: string; projectCode: string } | null
  perms?: QuotationPerms
}) {
  const router = useRouter()
  const { quotation, lines, opportunityName } = detail
  const isDraft = quotation.status === "draft"
  const isSent = quotation.status === "sent"
  const isAccepted = quotation.status === "accepted"
  // A draft is only editable when the user also holds the update permission.
  const canEditDraft = isDraft && perms.canUpdate
  const createProjectHref = `/projects/new?opportunityId=${quotation.opportunityId}`
  const [busy, setBusy] = React.useState(false)
  // "Build" = the editor; "Preview" = the finished quotation document (toggle
  // like the funnel board/list).
  const [view, setView] = React.useState("build")

  // Whether the Actions card has anything to show for this user/status.
  const showSend = isDraft && perms.canSend
  const showAcceptReject = isSent && perms.canAccept
  const showCreateProject = isAccepted && !project && perms.canCreateProject
  const showSetPrimary =
    !quotation.isPrimary &&
    (quotation.status === "accepted" || quotation.status === "sent") &&
    perms.canUpdate
  const showDelete = perms.canDelete
  const hasAnyAction =
    showSend || showAcceptReject || showCreateProject || showSetPrimary || showDelete

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: {
      taxSettingId: quotation.taxSettingId ?? NO_TAX,
      projectNatureCode: quotation.projectNatureCode ?? NO_PROJECT_NATURE,
      validUntil: quotation.validUntil ?? "",
      notes: quotation.notes ?? "",
      headerDiscount: quotation.headerDiscount ?? "0",
      lines:
        lines.length > 0
          ? lines.map((l) => ({
              productId: l.productId ?? "",
              projectNatureCode: l.projectNatureCode ?? "",
              uom: l.uom ?? "",
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountAmount: l.discountAmount,
            }))
          : [
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

  // Product picker items + a helper that fills a line from the chosen product.
  const NO_PRODUCT = "__custom__"
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
      form.setValue(`lines.${index}.unitPrice`, Number(p.standardPrice).toString(), {
        shouldValidate: true,
      })
      form.setValue(`lines.${index}.uom`, p.uom ?? "")
    },
    [products, form]
  )

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  })

  // Live totals: watch lines + tax selection and recompute with the shared formula.
  const watchedLines = useWatch({ control: form.control, name: "lines" })
  const watchedTaxId = useWatch({ control: form.control, name: "taxSettingId" })
  const watchedHeaderDiscount = useWatch({
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
        headerDiscount: watchedHeaderDiscount || "0",
        taxInclusive,
      }),
    [watchedLines, ratePercent, watchedHeaderDiscount, taxInclusive]
  )

  // A draft live-previews from the form; a sent/accepted/etc. quote is a frozen
  // document — render the stored snapshot totals/line breakdown so editing a tax
  // rate later never retro-alters it.
  const display = isDraft
    ? {
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
      }
    : {
        subtotal: Number(quotation.subtotal),
        discountTotal: Number(quotation.discountTotal),
        taxTotal: Number(quotation.taxTotal),
        total: Number(quotation.total),
      }
  const lineTotalAt = (i: number): number | string =>
    isDraft ? totals.lines[i]?.lineTotal ?? 0 : lines[i]?.lineTotal ?? 0
  // A draft tracks the live tenant flag; a frozen quote shows the value snapshot
  // onto it at create/send time, so the label never drifts after a settings flip.
  const labelTaxInclusive = isDraft ? taxInclusive : quotation.taxInclusive

  // Rows for the read-only Preview document — live form values for a draft, the
  // frozen snapshot otherwise.
  const previewLines = isDraft
    ? (watchedLines ?? []).map((l, i) => ({
        description: l.description,
        quantity: l.quantity,
        uom: l.uom,
        unitPrice: l.unitPrice,
        discount: l.discountAmount,
        lineTotal: totals.lines[i]?.lineTotal ?? 0,
      }))
    : lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        uom: l.uom ?? "",
        unitPrice: l.unitPrice,
        discount: l.discountAmount,
        lineTotal: l.lineTotal,
      }))

  // Project-nature options for the picker. Include the quote's stored code even if
  // it's no longer in the tenant picklist, so a stale snapshot stays selectable.
  const projectNatureItems = React.useMemo(() => {
    const items = projectNatures.map((p) => ({ value: p.code, label: p.name }))
    const current = quotation.projectNatureCode
    if (current && !items.some((p) => p.value === current))
      items.push({ value: current, label: current })
    return items
  }, [projectNatures, quotation.projectNatureCode])
  const projectNatureName =
    projectNatureItems.find((p) => p.value === quotation.projectNatureCode)?.label ??
    quotation.projectNatureCode

  async function onSave(values: FormValues) {
    setBusy(true)
    const res = await updateQuotation(quotation.id, {
      taxSettingId:
        values.taxSettingId === NO_TAX ? null : values.taxSettingId,
      projectNatureCode:
        values.projectNatureCode === NO_PROJECT_NATURE
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
    toast.success("Quotation saved")
    router.refresh()
    setBusy(false)
  }

  async function onAccept() {
    setBusy(true)
    const res = await acceptQuotation(quotation.id)
    if (!res.ok) {
      toast.error(res.error)
      setBusy(false)
      return
    }
    if (res.data.warning) toast.warning(res.data.warning)
    if (res.data.pendingApproval) {
      // Auto-win is gated behind an approval request — the funnel is NOT won
      // yet, so don't offer the "Create project" forward step as if it had.
      toast.success(
        "Quotation accepted — winning the funnel is pending approval"
      )
    } else {
      // The highest-value moment: offer the forward step (create the project).
      toast.success("Quotation accepted", {
        action: {
          label: "Create project",
          onClick: () => router.push(createProjectHref),
        },
      })
    }
    router.refresh()
    setBusy(false)
  }

  async function onSetPrimary() {
    setBusy(true)
    const res = await setPrimaryQuotation(quotation.id)
    if (!res.ok) {
      toast.error(res.error)
      setBusy(false)
      return
    }
    const previousId = res.data.previousPrimaryId
    // Set-primary re-values the funnel + shifts the forecast, so make it
    // reversible: offer an Undo that restores the prior primary quote.
    toast.success("Set as primary quotation", {
      description: "This re-values the funnel and shifts the forecast.",
      ...(previousId
        ? {
            action: {
              label: "Undo",
              onClick: async () => {
                const undo = await setPrimaryQuotation(previousId)
                if (!undo.ok) {
                  toast.error(undo.error)
                  return
                }
                toast.success("Primary quotation restored")
                router.refresh()
              },
            },
          }
        : {}),
    })
    router.refresh()
    setBusy(false)
  }

  async function runAction(
    fn: () => Promise<ActionResult<unknown>>,
    successMsg: string,
    options?: { redirect?: string }
  ) {
    setBusy(true)
    const res = await fn()
    if (!res.ok) {
      toast.error(res.error)
      setBusy(false)
      return
    }
    toast.success(successMsg)
    if (options?.redirect) router.push(options.redirect)
    else router.refresh()
    setBusy(false)
  }

  return (
    <Tabs value={view} onValueChange={setView} className="gap-4">
      <TabsList>
        <TabsTrigger value="build">Build</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
      </TabsList>

      <TabsContent value="build" className="grid gap-6 lg:grid-cols-4">
      {/* Facts/Actions/Related sit on the LEFT (house record anatomy);
          the build form takes the wide right column. */}
      <div className="lg:order-2 lg:col-span-3">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSave)} className="grid gap-6">
            {!isDraft ? (
              <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                {isSent
                  ? `This quotation was sent${
                      quotation.sentAt
                        ? ` on ${formatDate(quotation.sentAt)}`
                        : ""
                    } and is now read-only.`
                  : isAccepted
                    ? `This quotation was accepted${
                        quotation.acceptedAt
                          ? ` on ${formatDate(quotation.acceptedAt)}`
                          : ""
                      } and is now read-only.`
                    : "This quotation is read-only."}{" "}
                To change pricing, create a revision from the funnel.
              </div>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>Header</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="taxSettingId"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-1.5">
                        <FormLabel>Tax setting</FormLabel>
                        <InfoHint label="How is tax applied to this quotation?">
                          {labelTaxInclusive
                            ? "Tax-inclusive: line prices already include tax, so the tax shown is extracted from the total rather than added on top."
                            : "Tax-exclusive: the selected rate is added on top of the line subtotal."}
                        </InfoHint>
                      </div>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={!canEditDraft}
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
                {projectNatureItems.length > 0 ? (
                  <FormField
                    control={form.control}
                    name="projectNatureCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project nature</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={!canEditDraft}
                          items={[
                            { value: NO_PROJECT_NATURE, label: "None" },
                            ...projectNatureItems,
                          ]}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="None" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NO_PROJECT_NATURE}>None</SelectItem>
                            {projectNatureItems.map((p) => (
                              <SelectItem key={p.value} value={p.value}>
                                {p.label}
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
                        <Input type="date" disabled={!canEditDraft} {...field} />
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
                      <FormLabel>Header discount ({quotation.currency})</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          disabled={!canEditDraft}
                          placeholder="0.00"
                          {...field}
                        />
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
                          rows={3}
                          disabled={!canEditDraft}
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
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Line items</CardTitle>
                {canEditDraft ? (
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
                ) : null}
              </CardHeader>
              <CardContent className="grid gap-3">
                {form.formState.errors.lines?.root ? (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.lines.root.message}
                  </p>
                ) : null}
                {fields.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No line items.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="w-8 py-2 pr-2 font-medium">#</th>
                          <th className="py-2 pr-2 font-medium">Product</th>
                          <th className="py-2 pr-2 font-medium">Description</th>
                          <th className="w-20 py-2 pr-2 text-right font-medium">
                            Qty
                          </th>
                          <th className="w-14 py-2 pr-2 font-medium">UOM</th>
                          <th className="w-28 py-2 pr-2 text-right font-medium">
                            Unit price
                          </th>
                          <th className="w-28 py-2 pr-2 text-right font-medium">
                            Disc ({quotation.currency})
                          </th>
                          <th className="w-28 py-2 pr-2 text-right font-medium">
                            Line total
                          </th>
                          {canEditDraft ? <th className="w-8 py-2" /> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((f, i) => {
                          const line = watchedLines?.[i]
                          return (
                            <tr
                              key={f.id}
                              className="border-b align-middle last:border-0"
                            >
                              <td className="py-1.5 pr-2 text-muted-foreground tabular-nums">
                                {i + 1}
                              </td>
                              <td className="py-1.5 pr-2">
                                {products.length > 0 ? (
                                  <Combobox
                                    value={line?.productId || NO_PRODUCT}
                                    onChange={(v) =>
                                      applyProduct(i, v || NO_PRODUCT)
                                    }
                                    options={productItems}
                                    disabled={!canEditDraft}
                                    placeholder="Pick a product…"
                                    searchPlaceholder="Search products…"
                                    emptyMessage="No products found."
                                    className="min-w-44"
                                  />
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="py-1.5 pr-2">
                                <Input
                                  className="min-w-44"
                                  placeholder="Description"
                                  disabled={!canEditDraft}
                                  {...form.register(`lines.${i}.description`)}
                                />
                              </td>
                              <td className="py-1.5 pr-2">
                                <Input
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  className="w-20 text-right tabular-nums"
                                  disabled={!canEditDraft}
                                  {...form.register(`lines.${i}.quantity`)}
                                />
                              </td>
                              <td className="py-1.5 pr-2 text-muted-foreground">
                                {line?.uom || "—"}
                              </td>
                              <td
                                className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground"
                                title="Inherited from the product — pick a product to set it"
                              >
                                {formatMoney(
                                  line?.unitPrice ?? 0,
                                  quotation.currency
                                )}
                              </td>
                              <td className="py-1.5 pr-2">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className="w-24 text-right tabular-nums"
                                  disabled={!canEditDraft}
                                  {...form.register(`lines.${i}.discountAmount`)}
                                />
                              </td>
                              <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
                                {formatMoney(lineTotalAt(i), quotation.currency)}
                              </td>
                              {canEditDraft ? (
                                <td className="py-1.5 text-right">
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
                              ) : null}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {canEditDraft ? (
                  <p className="text-xs text-muted-foreground">
                    Pick a product to set the line — its <strong>unit price</strong>{" "}
                    is inherited and can&apos;t be edited here. Adjust qty and
                    discount inline.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {canEditDraft ? (
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save draft"}
                </Button>
              </div>
            ) : null}
          </form>
        </Form>
      </div>

      <div className="grid h-fit gap-6 lg:order-1 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{quotation.quoteNumber}</CardTitle>
            <StatusBadge status={quotation.status} className="capitalize" />
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label="Subtotal" value={formatMoney(display.subtotal, quotation.currency)} />
            <Row
              label="Discount"
              value={formatMoney(display.discountTotal, quotation.currency)}
            />
            <Row
              label={`Tax${labelTaxInclusive ? " (incl.)" : ""}`}
              value={formatMoney(display.taxTotal, quotation.currency)}
            />
            {quotation.taxRateSnapshot != null ? (
              <Row
                label="Tax rate (locked)"
                value={`${Number(quotation.taxRateSnapshot).toFixed(2)}%`}
              />
            ) : null}
            <Separator className="my-1" />
            <div className="flex items-center justify-between font-medium">
              <span>Total</span>
              <span className="tabular-nums">
                {formatMoney(display.total, quotation.currency)}
              </span>
            </div>
            <Row
              label="Project nature"
              value={projectNatureName ?? "—"}
            />
            {quotation.isPrimary ? (
              <div className="mt-1 flex items-center gap-1.5">
                <Badge variant="secondary" className="w-fit">
                  Primary quotation
                </Badge>
                <InfoHint label="What is the primary quotation?">
                  The primary quotation drives the funnel’s value and its
                  weighted forecast.
                </InfoHint>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {hasAnyAction ? (
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {showSend ? (
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="default" disabled={busy}>
                      Send
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Send this quotation?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Sending freezes {quotation.quoteNumber}: it becomes
                      read-only and its pricing, line items and tax rate are
                      locked in. To change anything afterwards you’ll need to
                      create a revision from the funnel.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        runAction(
                          () => sendQuotation(quotation.id),
                          "Quotation sent"
                        )
                      }
                    >
                      Send
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            {showAcceptReject ? (
              <>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button variant="default" disabled={busy}>
                        Accept
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Accept this quotation?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Accepting marks {quotation.quoteNumber} as the funnel’s
                        primary, winning quotation. If auto-win is enabled this
                        also moves the funnel to Won (or raises an approval
                        request) and lets you start a project. This can’t be
                        undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={onAccept}>
                        Accept
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button variant="outline" disabled={busy}>
                        Reject
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Reject this quotation?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Rejecting {quotation.quoteNumber} drops it from the
                        funnel’s value. If it’s the primary quote, another live
                        quotation is promoted in its place.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          runAction(
                            () => rejectQuotation(quotation.id),
                            "Quotation rejected"
                          )
                        }
                      >
                        Reject
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : null}
            {showCreateProject ? (
              <Button
                variant="default"
                disabled={busy}
                nativeButton={false}
                render={<Link href={createProjectHref} />}
              >
                Create project
              </Button>
            ) : null}
            {showSetPrimary ? (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={busy}
                  onClick={onSetPrimary}
                >
                  Set primary
                </Button>
                <InfoHint label="What does setting a primary quotation do?">
                  The primary quotation sets the funnel’s value — making this
                  one primary re-values the funnel and shifts the weighted
                  forecast. You can undo it right after.
                </InfoHint>
              </div>
            ) : null}

            {showDelete ? (
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="destructive" disabled={busy}>
                      Delete
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this quotation?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This soft-deletes {quotation.quoteNumber}. It will no
                      longer appear in the list.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() =>
                        runAction(
                          () => deleteQuotation(quotation.id),
                          "Quotation deleted",
                          { redirect: "/quotations" }
                        )
                      }
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </CardContent>
        </Card>
        ) : null}

        {/* Related quick links — same anatomy as the project/account pages. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Related</CardTitle>
          </CardHeader>
          <CardContent>
            <RelatedQuickLinks
              items={[
                {
                  kind: "funnel",
                  label: opportunityName ?? "Funnel",
                  href: `/funnel/${quotation.opportunityId}`,
                },
                ...(detail.accountId
                  ? [
                      {
                        kind: "account" as const,
                        label: detail.accountName ?? "Account",
                        href: `/accounts/${detail.accountId}`,
                      },
                    ]
                  : []),
                project
                  ? {
                      kind: "project" as const,
                      label: project.projectCode,
                      href: `/projects/${project.id}`,
                    }
                  : { kind: "project" as const, label: "Projects", count: 0, href: "/projects" },
                {
                  kind: "product" as const,
                  label: "Products",
                  count: lines.filter((l) => l.productId).length,
                  href: "/products",
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
      </TabsContent>

      <TabsContent value="preview" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            This is how your quotation prints as a PDF.
          </p>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link
                href={`/quotations/${quotation.id}/preview`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <PrinterIcon className="size-4" />
            Open / Print PDF
          </Button>
        </div>

        {/* PDF-style A4 document floating on a desk background. */}
        <div className="flex justify-center rounded-lg bg-muted/40 p-4 sm:p-6">
          <div className="w-[210mm] max-w-full min-h-[297mm] overflow-hidden rounded-sm bg-white text-zinc-900 shadow-lg ring-1 ring-zinc-200">
            <div className="h-2 w-full bg-red-600" />
            <div className="grid gap-6 p-[14mm]">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-5">
              <div className="grid gap-0.5">
                <span className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-zinc-400">
                  Quotation
                </span>
                <span className="font-mono text-xl font-semibold text-red-600">
                  {quotation.quoteNumber}
                </span>
                {opportunityName ? (
                  <span className="text-sm text-zinc-500">{opportunityName}</span>
                ) : null}
              </div>
              <div className="grid justify-items-end gap-1 text-sm">
                <StatusBadge status={quotation.status} className="capitalize" />
                {quotation.validUntil ? (
                  <span className="text-zinc-500">
                    Valid until {formatDate(quotation.validUntil)}
                  </span>
                ) : null}
              </div>
            </div>

            {detail.accountName ? (
              <div className="grid gap-0.5">
                <span className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-zinc-400">
                  Bill to
                </span>
                <span className="font-medium">{detail.accountName}</span>
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-400">
                    <th className="w-8 py-2 pr-2 font-medium">#</th>
                    <th className="py-2 pr-2 font-medium">Description</th>
                    <th className="py-2 pr-2 text-right font-medium">Qty</th>
                    <th className="py-2 pr-2 font-medium">UOM</th>
                    <th className="py-2 pr-2 text-right font-medium">Unit price</th>
                    <th className="py-2 pr-2 text-right font-medium">Disc</th>
                    <th className="py-2 pr-2 text-right font-medium">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {previewLines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-3 text-zinc-400">
                        No line items.
                      </td>
                    </tr>
                  ) : (
                    previewLines.map((l, i) => (
                      <tr
                        key={i}
                        className="border-b border-zinc-200 last:border-0"
                      >
                        <td className="py-2 pr-2 text-zinc-400 tabular-nums">
                          {i + 1}
                        </td>
                        <td className="py-2 pr-2">{l.description || "—"}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">
                          {l.quantity}
                        </td>
                        <td className="py-2 pr-2 text-zinc-500">
                          {l.uom || "—"}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">
                          {formatMoney(l.unitPrice, quotation.currency)}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">
                          {Number(l.discount) > 0
                            ? `−${formatMoney(l.discount, quotation.currency)}`
                            : "—"}
                        </td>
                        <td className="py-2 pr-2 text-right font-medium tabular-nums">
                          {formatMoney(l.lineTotal, quotation.currency)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="ml-auto grid w-full max-w-xs gap-1 text-sm">
              <DocRow
                label="Subtotal"
                value={formatMoney(display.subtotal, quotation.currency)}
              />
              <DocRow
                label="Discount"
                value={formatMoney(display.discountTotal, quotation.currency)}
              />
              <DocRow
                label={`Tax${labelTaxInclusive ? " (incl.)" : ""}`}
                value={formatMoney(display.taxTotal, quotation.currency)}
              />
              <div className="my-1 border-t border-zinc-200" />
              <div className="flex items-center justify-between text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">
                  {formatMoney(display.total, quotation.currency)}
                </span>
              </div>
            </div>

            {(isDraft ? form.watch("notes") : quotation.notes) ? (
              <div className="grid gap-0.5 border-t border-zinc-200 pt-4">
                <span className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-zinc-400">
                  Notes
                </span>
                <p className="text-sm whitespace-pre-wrap text-zinc-600">
                  {isDraft ? form.watch("notes") : quotation.notes}
                </p>
              </div>
            ) : null}
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
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

/** Totals row inside the white PDF-style preview document (fixed zinc colours). */
function DocRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-zinc-500">
      <span>{label}</span>
      <span className="tabular-nums text-zinc-900">{value}</span>
    </div>
  )
}

/** A small "?" trigger that explains a domain concept inline, at the point of
 *  decision (tax mode, primary quotation, etc.). */
function InfoHint({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={label}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <HelpCircleIcon className="size-3.5" />
            </button>
          }
        />
        <TooltipContent>{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
