"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/status-badge"
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
  validUntil: z.string(),
  notes: z.string(),
  headerDiscount: headerDiscountSchema,
  lines: z.array(quotationLineSchema).min(1, "Add at least one line item"),
})

type FormValues = z.infer<typeof schema>

const NO_TAX = "__none__"

type TaxOption = { id: string; name: string; ratePercent: string; isDefault: boolean }

export function QuotationForm({
  detail,
  taxOptions,
  taxInclusive,
  hasProject = false,
}: {
  detail: QuotationDetail
  taxOptions: TaxOption[]
  taxInclusive: boolean
  /** True when a non-deleted project already exists for this quotation. */
  hasProject?: boolean
}) {
  const router = useRouter()
  const { quotation, lines, opportunityName } = detail
  const isDraft = quotation.status === "draft"
  const isSent = quotation.status === "sent"
  const isAccepted = quotation.status === "accepted"
  const createProjectHref = `/projects/new?opportunityId=${quotation.opportunityId}`
  const [busy, setBusy] = React.useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      taxSettingId: quotation.taxSettingId ?? NO_TAX,
      validUntil: quotation.validUntil ?? "",
      notes: quotation.notes ?? "",
      headerDiscount: quotation.headerDiscount ?? "0",
      lines:
        lines.length > 0
          ? lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountPercent: l.discountPercent,
            }))
          : [{ description: "", quantity: "1", unitPrice: "0", discountPercent: "0" }],
    },
  })

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
          discountPercent: l.discountPercent,
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

  async function onSave(values: FormValues) {
    setBusy(true)
    const res = await updateQuotation(quotation.id, {
      taxSettingId:
        values.taxSettingId === NO_TAX ? null : values.taxSettingId,
      validUntil: values.validUntil || null,
      notes: values.notes || null,
      headerDiscount: values.headerDiscount || "0",
      lines: values.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent || "0",
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
    // The highest-value moment: offer the forward step (create the project).
    toast.success("Quotation accepted", {
      action: {
        label: "Create project",
        onClick: () => router.push(createProjectHref),
      },
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
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
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
                <div className="grid gap-2">
                  <FormLabel>Funnel</FormLabel>
                  <div className="flex h-9 items-center">
                    {opportunityName ? (
                      <Link
                        href={`/funnel/${quotation.opportunityId}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        {opportunityName}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
                <FormField
                  control={form.control}
                  name="taxSettingId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tax setting</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={!isDraft}
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
                <FormField
                  control={form.control}
                  name="validUntil"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valid until</FormLabel>
                      <FormControl>
                        <Input type="date" disabled={!isDraft} {...field} />
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
                          disabled={!isDraft}
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
                          disabled={!isDraft}
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
                {isDraft ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      append({
                        description: "",
                        quantity: "1",
                        unitPrice: "0",
                        discountPercent: "0",
                      })
                    }
                  >
                    <Plus /> Add line
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="grid gap-4">
                {fields.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No line items.</p>
                ) : null}
                {form.formState.errors.lines?.root ? (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.lines.root.message}
                  </p>
                ) : null}
                {fields.map((f, i) => {
                  return (
                    <div key={f.id} className="grid gap-3 rounded-lg border p-3">
                      <FormField
                        control={form.control}
                        name={`lines.${i}.description`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs" required>
                              Description
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Service description"
                                disabled={!isDraft}
                                {...field}
                              />
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
                                <Input
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  disabled={!isDraft}
                                  {...field}
                                />
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
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  disabled={!isDraft}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`lines.${i}.discountPercent`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Disc %</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  disabled={!isDraft}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid gap-2">
                          <FormLabel className="text-xs">Line total</FormLabel>
                          <div className="flex h-8 items-center text-sm tabular-nums">
                            {formatMoney(lineTotalAt(i), quotation.currency)}
                          </div>
                        </div>
                      </div>
                      {isDraft ? (
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
                      ) : null}
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            {isDraft ? (
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save draft"}
                </Button>
              </div>
            ) : null}
          </form>
        </Form>
      </div>

      <div className="grid h-fit gap-6">
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
            {quotation.isPrimary ? (
              <Badge variant="secondary" className="mt-1 w-fit">
                Primary quotation
              </Badge>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {isDraft ? (
              <Button
                variant="default"
                disabled={busy}
                onClick={() =>
                  runAction(() => sendQuotation(quotation.id), "Quotation sent")
                }
              >
                Send
              </Button>
            ) : null}
            {isSent ? (
              <>
                <Button variant="default" disabled={busy} onClick={onAccept}>
                  Accept
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    runAction(() => rejectQuotation(quotation.id), "Quotation rejected")
                  }
                >
                  Reject
                </Button>
              </>
            ) : null}
            {isAccepted && !hasProject ? (
              <Button
                variant="default"
                disabled={busy}
                nativeButton={false}
                render={<Link href={createProjectHref} />}
              >
                Create project
              </Button>
            ) : null}
            {!quotation.isPrimary &&
            (quotation.status === "accepted" || quotation.status === "sent") ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  runAction(
                    () => setPrimaryQuotation(quotation.id),
                    "Set as primary"
                  )
                }
              >
                Set primary
              </Button>
            ) : null}

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
                    This soft-deletes {quotation.quoteNumber}. It will no longer
                    appear in the list.
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
          </CardContent>
        </Card>
      </div>
    </div>
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
