"use client"

import * as React from "react"
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
import { formatMoney } from "@/lib/format"
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

const lineSchema = z.object({
  description: z.string().trim().min(1, "Required"),
  quantity: z.string().trim().min(1, "Required"),
  unitPrice: z.string().trim().min(1, "Required"),
  discountPercent: z.string().trim(),
})

const schema = z.object({
  taxSettingId: z.string(),
  validUntil: z.string(),
  notes: z.string(),
  lines: z.array(lineSchema),
})

type FormValues = z.infer<typeof schema>

const NO_TAX = "__none__"

type TaxOption = { id: string; name: string; ratePercent: string; isDefault: boolean }

export function QuotationForm({
  detail,
  taxOptions,
  taxInclusive,
}: {
  detail: QuotationDetail
  taxOptions: TaxOption[]
  taxInclusive: boolean
}) {
  const router = useRouter()
  const { quotation, lines, opportunityName } = detail
  const isDraft = quotation.status === "draft"
  const isSent = quotation.status === "sent"
  const [busy, setBusy] = React.useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      taxSettingId: quotation.taxSettingId ?? NO_TAX,
      validUntil: quotation.validUntil ?? "",
      notes: quotation.notes ?? "",
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
        taxInclusive,
      }),
    [watchedLines, ratePercent, taxInclusive]
  )

  async function onSave(values: FormValues) {
    setBusy(true)
    try {
      await updateQuotation(quotation.id, {
        taxSettingId:
          values.taxSettingId === NO_TAX ? null : values.taxSettingId,
        validUntil: values.validUntil || null,
        notes: values.notes || null,
        lines: values.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent || "0",
        })),
      })
      toast.success("Quotation saved")
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed")
    } finally {
      setBusy(false)
    }
  }

  async function runAction(
    fn: () => Promise<void>,
    successMsg: string,
    options?: { redirect?: string }
  ) {
    setBusy(true)
    try {
      await fn()
      toast.success(successMsg)
      if (options?.redirect) router.push(options.redirect)
      else router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSave)} className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Header</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <FormLabel>Funnel</FormLabel>
                  <Input value={opportunityName ?? "—"} disabled readOnly />
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
                            label: `${t.name} (${t.ratePercent}%)`,
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
                              {t.name} ({t.ratePercent}%)
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
                {fields.map((f, i) => {
                  const line = totals.lines[i]
                  return (
                    <div key={f.id} className="grid gap-3 rounded-lg border p-3">
                      <FormField
                        control={form.control}
                        name={`lines.${i}.description`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Description</FormLabel>
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
                              <FormLabel className="text-xs">Qty</FormLabel>
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
                              <FormLabel className="text-xs">Unit price</FormLabel>
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
                            {formatMoney(line?.lineTotal ?? 0, quotation.currency)}
                          </div>
                        </div>
                      </div>
                      {isDraft ? (
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
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
            <Badge className="capitalize">{quotation.status}</Badge>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label="Subtotal" value={formatMoney(totals.subtotal, quotation.currency)} />
            <Row
              label="Discount"
              value={formatMoney(totals.discountTotal, quotation.currency)}
            />
            <Row
              label={`Tax${taxInclusive ? " (incl.)" : ""}`}
              value={formatMoney(totals.taxTotal, quotation.currency)}
            />
            <Separator className="my-1" />
            <div className="flex items-center justify-between font-medium">
              <span>Total</span>
              <span className="tabular-nums">
                {formatMoney(totals.total, quotation.currency)}
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
                <Button
                  variant="default"
                  disabled={busy}
                  onClick={() =>
                    runAction(() => acceptQuotation(quotation.id), "Quotation accepted")
                  }
                >
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
