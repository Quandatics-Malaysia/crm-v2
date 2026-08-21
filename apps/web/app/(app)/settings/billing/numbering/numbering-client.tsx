"use client"

import * as React from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { showActionError } from "@/lib/show-action-error"
import { Plus, X } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { cn } from "@/lib/utils"
import {
  updateNumbering,
  updateMilestoneTemplate,
  type TenantSettingsView,
} from "@/app/(app)/settings/actions"

const numberingSchema = z.object({
  quoteNextNumber: z.coerce.number().int().min(1, "≥ 1"),
  quotePadWidth: z.coerce.number().int().min(1, "1–10").max(10, "1–10"),
  soNextNumber: z.coerce.number().int().min(1, "≥ 1"),
  soPadWidth: z.coerce.number().int().min(1, "1–10").max(10, "1–10"),
  projectPadWidth: z.coerce.number().int().min(1, "1–10").max(10, "1–10"),
  /** Empty = no default validity prefill. */
  quoteValidDays: z
    .string()
    .trim()
    .refine(
      (v) =>
        v === "" ||
        (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 365),
      "1–365 days"
    ),
  /** Empty = built-in default (30 days). */
  invoiceDueDays: z
    .string()
    .trim()
    .refine(
      (v) =>
        v === "" ||
        (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 365),
      "1–365 days"
    ),
})

type NumberingValues = z.input<typeof numberingSchema>

function pad(n: number, width: number): string {
  return String(Math.max(0, n)).padStart(Math.max(1, width), "0")
}

function NumberingForm({ settings }: { settings: TenantSettingsView }) {
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<NumberingValues>({
    resolver: zodResolver(numberingSchema),
    defaultValues: {
      quoteNextNumber: settings.quoteNextNumber,
      quotePadWidth: settings.quotePadWidth,
      soNextNumber: settings.soNextNumber,
      soPadWidth: settings.soPadWidth,
      projectPadWidth: settings.projectPadWidth,
      quoteValidDays:
        settings.quoteValidDays == null ? "" : String(settings.quoteValidDays),
      invoiceDueDays:
        settings.invoiceDueDays == null ? "" : String(settings.invoiceDueDays),
    },
  })

  const currentYear = new Date().getFullYear()
  const entityCode = (settings.entityCode || "ENTITY").toUpperCase()
  const values = useWatch({ control: form.control })
  // Quote numbers mint as Q1{running}-{rev} (see nextQuoteNumber /
  // lib/quote-number.ts) — a Salesforce-format reference, not entity-coded.
  // This preview shows a brand-new funnel's first quote (rev 1); the running
  // number itself is shared by every quote on the same funnel, not entity code.
  const quotePreview = `Q1${pad(
    Number(values.quoteNextNumber) || 0,
    Number(values.quotePadWidth) || 1
  )}-1`
  // SO numbers mint as {ENTITY}SO-{running} (see nextSoNumber).
  const soPreview = `${entityCode}SO-${pad(
    Number(values.soNextNumber) || 0,
    Number(values.soPadWidth) || 1
  )}`
  const soBelowIssued =
    Number(values.soNextNumber) > 0 &&
    Number(values.soNextNumber) < settings.soNextNumber
  // Project codes are {YYYY}-{Entity}-{Account}-{ProjectNature}-{NNN}; the running
  // number (NNN) resets to 1 each year, so the preview always shows the first.
  const projectPreview = `${currentYear}-${entityCode}-ACME-WEB-${pad(
    1,
    Number(values.projectPadWidth) || 1
  )}`
  // The stored quote counter is (highest issued + 1); going below re-issues.
  const quoteBelowIssued =
    Number(values.quoteNextNumber) > 0 &&
    Number(values.quoteNextNumber) < settings.quoteNextNumber

  function onSubmit(raw: NumberingValues) {
    const parsed = numberingSchema.parse(raw)
    startTransition(async () => {
      const res = await updateNumbering({
        ...parsed,
        quoteValidDays:
          parsed.quoteValidDays === "" ? null : Number(parsed.quoteValidDays),
        invoiceDueDays:
          parsed.invoiceDueDays === "" ? null : Number(parsed.invoiceDueDays),
      })
      if (!res.ok) {
        showActionError(res)
        return
      }
      const updated = res.data
      form.reset({
        quoteNextNumber: updated.quoteNextNumber,
        quotePadWidth: updated.quotePadWidth,
        soNextNumber: updated.soNextNumber,
        soPadWidth: updated.soPadWidth,
        projectPadWidth: updated.projectPadWidth,
        quoteValidDays:
          updated.quoteValidDays == null ? "" : String(updated.quoteValidDays),
        invoiceDueDays:
          updated.invoiceDueDays == null ? "" : String(updated.invoiceDueDays),
      })
      toast.success("Numbering saved")
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Quotation numbering</CardTitle>
            <CardDescription>
              Next quote: <span className="font-mono">{quotePreview}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="quoteNextNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Next number</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      value={String(field.value ?? "")}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  {quoteBelowIssued ? (
                    <p className="text-sm text-destructive">
                      Number {settings.quoteNextNumber - 1} has already been
                      issued. Saving a value below {settings.quoteNextNumber} will
                      collide with existing quotes.
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="quotePadWidth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pad width</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      value={String(field.value ?? "")}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="quoteValidDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default validity (days)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      placeholder="e.g. 30"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Prefills “Valid until” on new quotes. Empty = no prefill.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {settings.financeEnabled ? (
              <FormField
                control={form.control}
                name="invoiceDueDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice due window (days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        placeholder="30"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Prefills the due date on new invoices. Empty = 30.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card className="hidden">
          <CardHeader>
            <CardTitle>Sales-order numbering</CardTitle>
            <CardDescription>Next sales order: <span className="font-mono">{soPreview}</span></CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="soNextNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Next number</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      value={String(field.value ?? "")}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  {soBelowIssued ? (
                    <p className="text-sm text-destructive">
                      Number {settings.soNextNumber - 1} has already been issued.
                      Saving a value below {settings.soNextNumber} will collide
                      with existing sales orders.
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="soPadWidth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pad width</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      value={String(field.value ?? "")}
                      onChange={(e) => field.onChange(e.target.value)}
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
            <CardTitle>Project numbering</CardTitle>
            <CardDescription>
              Example code:{" "}
              <span className="font-mono">{projectPreview}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <p className="text-sm text-muted-foreground">
              Project code: <span className="font-mono">{`{YYYY}-{Entity}-{Account}-{Nature}-{NNN}`}</span>. Only NNN padding is set here.
            </p>
            <FormField
              control={form.control}
              name="projectPadWidth"
              render={({ field }) => (
                <FormItem className="sm:max-w-[12rem]">
                  <FormLabel>Pad width</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      value={String(field.value ?? "")}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>Digits in NNN. Example: 3 → 001.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isPending || !form.formState.isDirty}
            onClick={() => form.reset()}
          >
            Reset
          </Button>
          <Button type="submit" disabled={isPending || !form.formState.isDirty}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Form>
  )
}

/**
 * Payment-milestone template: title + percent rows auto-seeded onto any new
 * project that starts with a value. Percents must sum to ≤ 100; the last
 * milestone absorbs cent rounding when the template allocates the full 100%.
 */
// Kept for compatibility with existing saved templates; the setting is
// intentionally hidden until the milestone workflow is ready for use.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function MilestoneTemplateCard({
  template,
}: {
  template: { title: string; percent: number }[]
}) {
  const [rows, setRows] = React.useState(
    template.map((t) => ({ title: t.title, percent: String(t.percent) }))
  )
  const [baseline, setBaseline] = React.useState(JSON.stringify(template))
  const [isPending, startTransition] = React.useTransition()

  const parsed = rows.map((r) => ({
    title: r.title.trim(),
    percent: Number(r.percent),
  }))
  const sum = parsed.reduce(
    (n, r) => n + (Number.isFinite(r.percent) ? r.percent : 0),
    0
  )
  const dirty = JSON.stringify(parsed) !== baseline

  function set(i: number, key: "title" | "percent", value: string) {
    setRows((prev) =>
      prev.map((r, j) => (j === i ? { ...r, [key]: value } : r))
    )
  }

  function save() {
    startTransition(async () => {
      const res = await updateMilestoneTemplate(parsed)
      if (!res.ok) {
        showActionError(res)
        return
      }
      setBaseline(JSON.stringify(res.data.milestoneTemplate))
      setRows(
        res.data.milestoneTemplate.map((t) => ({
          title: t.title,
          percent: String(t.percent),
        }))
      )
      toast.success("Milestone template saved")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment milestone template</CardTitle>
        <CardDescription>
          Auto-seeded onto every new project that has a value — e.g. 50%
          advance / 40% delivery / 10% acceptance. Leave empty to keep
          milestones fully manual.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={r.title}
              onChange={(e) => set(i, "title", e.target.value)}
              placeholder={`Milestone ${i + 1} (e.g. Advance payment)`}
            />
            <Input
              type="number"
              min={0}
              max={100}
              step="0.01"
              className="w-24 text-right tabular-nums"
              value={r.percent}
              onChange={(e) => set(i, "percent", e.target.value)}
              aria-label="Percent of project value"
            />
            <span className="text-sm text-muted-foreground">%</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
              aria-label="Remove milestone"
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRows((p) => [...p, { title: "", percent: "" }])
            }
          >
            <Plus className="size-4" />
            Add milestone
          </Button>
          <span
            className={cn(
              "text-sm tabular-nums",
              sum > 100 ? "text-destructive" : "text-muted-foreground"
            )}
          >
            Total {sum}%
          </span>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={save}
            disabled={isPending || !dirty || sum > 100}
          >
            {isPending ? "Saving…" : "Save template"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function NumberingClient({ settings }: { settings: TenantSettingsView }) {
  return (
    <div className="grid gap-6">
      <NumberingForm settings={settings} />
    </div>
  )
}
