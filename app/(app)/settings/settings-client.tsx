"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Plus,
  ReceiptText,
  Trash2,
  X,
} from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { DataTable, SortableHeader } from "@/components/data-table"
import { formatPercent } from "@/lib/format"
import {
  updateSettings,
  updateNumbering,
  updateIndustries,
  updateStage,
  createStage,
  deleteStage,
  reorderStages,
} from "./actions"
import type {
  TenantSettingsView,
  TenantMemberView,
  DefaultFunnelView,
  FunnelStageRow,
} from "./actions"
import { STAGE_CODES, STAGE_KINDS } from "./constants"
import type { StageCode, StageKind } from "./constants"

// ─── General ─────────────────────────────────────────────────────────────────

const generalSchema = z.object({
  defaultCurrency: z
    .string()
    .trim()
    .length(3, "Use a 3-letter ISO code")
    .transform((v) => v.toUpperCase()),
  fiscalYearStartMonth: z.coerce.number().int().min(1, "1–12").max(12, "1–12"),
  approvalBypassTier: z.coerce.number().int().min(0, "Must be ≥ 0"),
  entityCode: z.string().trim().max(16, "Keep it short").optional().default(""),
  taxInclusive: z.boolean(),
  autoWinOnQuoteAccept: z.boolean(),
  allowPasswordLogin: z.boolean(),
})

type GeneralValues = z.input<typeof generalSchema>

const SWITCHES: {
  name: "taxInclusive" | "autoWinOnQuoteAccept" | "allowPasswordLogin"
  label: string
  description: string
}[] = [
  {
    name: "taxInclusive",
    label: "Tax-inclusive pricing",
    description: "Quotation unit prices already include tax.",
  },
  {
    name: "autoWinOnQuoteAccept",
    label: "Auto-win on quote accept",
    description:
      "Move a funnel to Won automatically when its primary quote is accepted.",
  },
  {
    name: "allowPasswordLogin",
    label: "Allow password login",
    description: "Permit email + password sign-in for this entity.",
  },
]

function GeneralForm({ settings }: { settings: TenantSettingsView }) {
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<GeneralValues>({
    resolver: zodResolver(generalSchema),
    defaultValues: {
      defaultCurrency: settings.defaultCurrency,
      fiscalYearStartMonth: settings.fiscalYearStartMonth,
      approvalBypassTier: settings.approvalBypassTier,
      entityCode: settings.entityCode,
      taxInclusive: settings.taxInclusive,
      autoWinOnQuoteAccept: settings.autoWinOnQuoteAccept,
      allowPasswordLogin: settings.allowPasswordLogin,
    },
  })

  function onSubmit(values: GeneralValues) {
    const parsed = generalSchema.parse(values)
    startTransition(async () => {
      try {
        const updated = await updateSettings({
          defaultCurrency: parsed.defaultCurrency,
          fiscalYearStartMonth: parsed.fiscalYearStartMonth,
          approvalBypassTier: parsed.approvalBypassTier,
          entityCode: parsed.entityCode,
          taxInclusive: parsed.taxInclusive,
          autoWinOnQuoteAccept: parsed.autoWinOnQuoteAccept,
          allowPasswordLogin: parsed.allowPasswordLogin,
        })
        form.reset({
          defaultCurrency: updated.defaultCurrency,
          fiscalYearStartMonth: updated.fiscalYearStartMonth,
          approvalBypassTier: updated.approvalBypassTier,
          entityCode: updated.entityCode,
          taxInclusive: updated.taxInclusive,
          autoWinOnQuoteAccept: updated.autoWinOnQuoteAccept,
          allowPasswordLogin: updated.allowPasswordLogin,
        })
        toast.success("Settings saved")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save settings")
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <FormField
              control={form.control}
              name="defaultCurrency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default currency</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={3}
                      className="uppercase"
                      placeholder="MYR"
                    />
                  </FormControl>
                  <FormDescription>3-letter ISO code.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="entityCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Entity code</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="uppercase"
                      placeholder="DEMO"
                      maxLength={16}
                    />
                  </FormControl>
                  <FormDescription>Used in project codes.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fiscalYearStartMonth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fiscal year start month</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      value={String(field.value ?? "")}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>1 = January … 12 = December.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="approvalBypassTier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Approval bypass tier</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      value={String(field.value ?? "")}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>
                    Members at or above this tier advance stages without approval.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Behavior</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            {SWITCHES.map((s, i) => (
              <React.Fragment key={s.name}>
                {i > 0 ? <Separator className="my-1" /> : null}
                <FormField
                  control={form.control}
                  name={s.name}
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between gap-4 py-2">
                      <div className="grid gap-1">
                        <FormLabel>{s.label}</FormLabel>
                        <FormDescription>{s.description}</FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </React.Fragment>
            ))}
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

// ─── Numbering ───────────────────────────────────────────────────────────────

const numberingSchema = z.object({
  quotePrefix: z.string().trim().min(1, "Required"),
  quoteNextNumber: z.coerce.number().int().min(1, "≥ 1"),
  quotePadWidth: z.coerce.number().int().min(1, "1–10").max(10, "1–10"),
  projectNextNumber: z.coerce.number().int().min(1, "≥ 1"),
  projectPadWidth: z.coerce.number().int().min(1, "1–10").max(10, "1–10"),
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
      quotePrefix: settings.quotePrefix,
      quoteNextNumber: settings.quoteNextNumber,
      quotePadWidth: settings.quotePadWidth,
      projectNextNumber: settings.projectNextNumber,
      projectPadWidth: settings.projectPadWidth,
    },
  })

  const entityCode = (settings.entityCode || "ENTITY").toUpperCase()
  const values = useWatch({ control: form.control })
  const quotePreview = `${values.quotePrefix ?? ""}${pad(
    Number(values.quoteNextNumber) || 0,
    Number(values.quotePadWidth) || 1
  )}`
  const projectPreview = `${entityCode}-ACME-${pad(
    Number(values.projectNextNumber) || 0,
    Number(values.projectPadWidth) || 1
  )}`

  function onSubmit(raw: NumberingValues) {
    const parsed = numberingSchema.parse(raw)
    startTransition(async () => {
      try {
        const updated = await updateNumbering(parsed)
        form.reset({
          quotePrefix: updated.quotePrefix,
          quoteNextNumber: updated.quoteNextNumber,
          quotePadWidth: updated.quotePadWidth,
          projectNextNumber: updated.projectNextNumber,
          projectPadWidth: updated.projectPadWidth,
        })
        toast.success("Numbering saved")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save numbering")
      }
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
              name="quotePrefix"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Prefix</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Q-" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Project numbering</CardTitle>
            <CardDescription>
              Example code:{" "}
              <span className="font-mono">{`{YY}-${projectPreview}`}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="projectNextNumber"
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
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="projectPadWidth"
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

// ─── Industries ──────────────────────────────────────────────────────────────

function IndustriesCard({ industries }: { industries: string[] }) {
  const [items, setItems] = React.useState<string[]>(industries)
  const [draft, setDraft] = React.useState("")
  const [isPending, startTransition] = React.useTransition()

  const dirty = React.useMemo(() => {
    if (items.length !== industries.length) return true
    return items.some((v, i) => v !== industries[i])
  }, [items, industries])

  function add() {
    const name = draft.trim()
    if (!name) return
    if (items.some((v) => v.toLowerCase() === name.toLowerCase())) {
      toast.error("That industry is already in the list.")
      return
    }
    setItems((prev) => [...prev, name])
    setDraft("")
  }

  function remove(name: string) {
    setItems((prev) => prev.filter((v) => v !== name))
  }

  function save() {
    startTransition(async () => {
      try {
        const saved = await updateIndustries(items)
        setItems(saved)
        toast.success("Industries saved")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save industries")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Industries</CardTitle>
        <CardDescription>
          The picklist offered when classifying accounts.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            placeholder="e.g. Manufacturing"
          />
          <Button type="button" variant="outline" onClick={add}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>

        {items.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {items.map((name) => (
              <Badge key={name} variant="secondary" className="gap-1 pr-1">
                {name}
                <button
                  type="button"
                  onClick={() => remove(name)}
                  className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                  aria-label={`Remove ${name}`}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No industries yet.</p>
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : "Save industries"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Funnel stages ───────────────────────────────────────────────────────────

const stageSchema = z.object({
  code: z.enum(STAGE_CODES),
  kind: z.enum(STAGE_KINDS),
  name: z.string().trim().min(1, "Name is required"),
  probability: z
    .string()
    .trim()
    .refine(
      (v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100,
      "0–100"
    ),
  sortOrder: z.coerce.number().int().min(0, "≥ 0"),
  requiresApprovalToEnter: z.boolean(),
  includeInForecast: z.boolean(),
})

type StageValues = z.input<typeof stageSchema>

const KIND_OPTIONS = STAGE_KINDS.map((k) => ({ value: k, label: k }))

function StageDialog({
  open,
  onOpenChange,
  initial,
  usedCodes,
  nextSortOrder,
  trigger,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial?: FunnelStageRow
  usedCodes: StageCode[]
  nextSortOrder: number
  trigger?: React.ReactNode
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)

  const availableCodes = React.useMemo(
    () =>
      STAGE_CODES.filter(
        (c) => initial?.code === c || !usedCodes.includes(c)
      ).map((c) => ({ value: c, label: c })),
    [usedCodes, initial?.code]
  )

  const form = useForm<StageValues>({
    resolver: zodResolver(stageSchema),
    defaultValues: {
      code: (initial?.code as StageCode) ?? availableCodes[0]?.value ?? "0e",
      kind: (initial?.kind as StageKind) ?? "OPEN",
      name: initial?.name ?? "",
      probability: initial?.probability ?? "0",
      sortOrder: initial?.sortOrder ?? nextSortOrder,
      requiresApprovalToEnter: initial?.requiresApprovalToEnter ?? false,
      includeInForecast: initial?.includeInForecast ?? true,
    },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({
        code: (initial?.code as StageCode) ?? availableCodes[0]?.value ?? "0e",
        kind: (initial?.kind as StageKind) ?? "OPEN",
        name: initial?.name ?? "",
        probability: initial?.probability ?? "0",
        sortOrder: initial?.sortOrder ?? nextSortOrder,
        requiresApprovalToEnter: initial?.requiresApprovalToEnter ?? false,
        includeInForecast: initial?.includeInForecast ?? true,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function onSubmit(raw: StageValues) {
    const parsed = stageSchema.parse(raw)
    setSaving(true)
    try {
      if (initial) {
        await updateStage(initial.id, {
          name: parsed.name,
          probability: parsed.probability,
          requiresApprovalToEnter: parsed.requiresApprovalToEnter,
          includeInForecast: parsed.includeInForecast,
          sortOrder: parsed.sortOrder,
        })
        toast.success("Stage updated")
      } else {
        await createStage({
          code: parsed.code,
          kind: parsed.kind,
          name: parsed.name,
          probability: parsed.probability,
          requiresApprovalToEnter: parsed.requiresApprovalToEnter,
          includeInForecast: parsed.includeInForecast,
          sortOrder: parsed.sortOrder,
        })
        toast.success("Stage created")
      }
      onOpenChange(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit stage" : "New stage"}</DialogTitle>
          <DialogDescription>
            Stages define the pipeline. The forecast inclusion toggle decides
            whether a stage&apos;s deals count toward the billing forecast.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={!!initial}
                      items={availableCodes}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Pick a code" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableCodes.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Locked after creation.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kind</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={!!initial}
                      items={KIND_OPTIONS}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Pick a kind" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {KIND_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Semantics (locked).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Proposal Sent" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="probability"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Probability (%)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" max="100" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sortOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sort order</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
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
            </div>

            <FormField
              control={form.control}
              name="requiresApprovalToEnter"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-4">
                  <div className="grid gap-1">
                    <FormLabel>Requires approval to enter</FormLabel>
                    <FormDescription>
                      Advancing into this stage needs sign-off.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="includeInForecast"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-4">
                  <div className="grid gap-1">
                    <FormLabel>Include in forecast</FormLabel>
                    <FormDescription>
                      Count this stage&apos;s deals in the billing forecast.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : initial ? "Save changes" : "Create stage"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function StageRowActions({
  stage,
  usedCodes,
  nextSortOrder,
  index,
  total,
  onMove,
}: {
  stage: FunnelStageRow
  usedCodes: StageCode[]
  nextSortOrder: number
  index: number
  total: number
  onMove: (index: number, dir: -1 | 1) => void
}) {
  const router = useRouter()
  const [editOpen, setEditOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function onDelete() {
    setBusy(true)
    try {
      await deleteStage(stage.id)
      toast.success("Stage deleted")
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={index === 0}
        onClick={() => onMove(index, -1)}
        aria-label="Move up"
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={index === total - 1}
        onClick={() => onMove(index, 1)}
        aria-label="Move down"
      >
        <ArrowDown className="size-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setEditOpen(true)}
      >
        Edit
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onClick={onDelete}
        aria-label="Delete stage"
      >
        <Trash2 className="size-4 text-destructive" />
      </Button>
      <StageDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={stage}
        usedCodes={usedCodes}
        nextSortOrder={nextSortOrder}
      />
    </div>
  )
}

function FunnelStagesCard({ funnel }: { funnel: DefaultFunnelView }) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [reordering, setReordering] = React.useState(false)
  const [rows, setRows] = React.useState<FunnelStageRow[]>(funnel.stages)
  // Resync local row order whenever the server hands us a fresh list
  // (adjust-during-render pattern — no effect required).
  const [seenStages, setSeenStages] = React.useState(funnel.stages)
  if (seenStages !== funnel.stages) {
    setSeenStages(funnel.stages)
    setRows(funnel.stages)
  }

  const usedCodes = rows.map((s) => s.code as StageCode)
  const nextSortOrder =
    rows.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1

  const orderDirty = React.useMemo(
    () => rows.some((s, i) => s.id !== funnel.stages[i]?.id),
    [rows, funnel.stages]
  )

  function move(index: number, dir: -1 | 1) {
    setRows((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function saveOrder() {
    setReordering(true)
    const order = rows.map((s) => s.id)
    ;(async () => {
      try {
        await reorderStages(order)
        toast.success("Order saved")
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save order")
      } finally {
        setReordering(false)
      }
    })()
  }

  const columns: ColumnDef<FunnelStageRow>[] = [
    {
      id: "order",
      header: "#",
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {row.index + 1}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: ({ column }) => <SortableHeader column={column} title="Stage" />,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.original.name}</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {row.original.code}
          </Badge>
        </div>
      ),
    },
    {
      accessorKey: "kind",
      header: "Kind",
      cell: ({ row }) => (
        <Badge variant="secondary">{row.original.kind}</Badge>
      ),
    },
    {
      accessorKey: "probability",
      header: ({ column }) => (
        <SortableHeader column={column} title="Probability" />
      ),
      cell: ({ row }) => formatPercent(row.original.probability),
    },
    {
      id: "approval",
      header: "Approval",
      cell: ({ row }) =>
        row.original.requiresApprovalToEnter ? (
          <Badge variant="outline">Required</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "forecast",
      header: "Forecast",
      cell: ({ row }) =>
        row.original.includeInForecast ? (
          <Badge>Included</Badge>
        ) : (
          <Badge variant="outline">Excluded</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <StageRowActions
          stage={row.original}
          usedCodes={usedCodes}
          nextSortOrder={nextSortOrder}
          index={row.index}
          total={rows.length}
          onMove={move}
        />
      ),
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funnel stages</CardTitle>
        <CardDescription>
          {funnel.funnelName
            ? `Default funnel: "${funnel.funnelName}"`
            : "No default funnel configured."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={rows}
          emptyMessage="No stages yet."
          toolbar={
            <div className="flex items-center gap-2">
              {orderDirty ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={reordering}
                  onClick={saveOrder}
                >
                  {reordering ? "Saving…" : "Save order"}
                </Button>
              ) : null}
              <StageDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                usedCodes={usedCodes}
                nextSortOrder={nextSortOrder}
                trigger={
                  <DialogTrigger render={<Button size="sm">New stage</Button>} />
                }
              />
            </div>
          }
        />
      </CardContent>
    </Card>
  )
}

// ─── Team ────────────────────────────────────────────────────────────────────

const memberColumns: ColumnDef<TenantMemberView>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column} title="Name" />,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.name}</span>
        <span className="text-xs text-muted-foreground">{row.original.email}</span>
      </div>
    ),
  },
  {
    id: "role",
    accessorFn: (r) => r.roleName ?? "",
    header: "Role",
    cell: ({ row }) =>
      row.original.roleName ? (
        <Badge variant="secondary">{row.original.roleName}</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "tierLevel",
    header: ({ column }) => <SortableHeader column={column} title="Tier" />,
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.tierLevel}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={row.original.status === "active" ? "outline" : "secondary"}>
        {row.original.status}
      </Badge>
    ),
  },
]

function TeamTable({ members }: { members: TenantMemberView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>
          Read-only — manage membership from the admin tools.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={memberColumns}
          data={members}
          searchColumn="name"
          searchPlaceholder="Search members…"
          emptyMessage="No members found."
        />
      </CardContent>
    </Card>
  )
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function SettingsClient({
  settings,
  members,
  funnel,
}: {
  settings: TenantSettingsView
  members: TenantMemberView[]
  funnel: DefaultFunnelView
}) {
  return (
    <Tabs defaultValue="general" className="w-full">
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="numbering">Numbering</TabsTrigger>
        <TabsTrigger value="industries">Industries</TabsTrigger>
        <TabsTrigger value="stages">Funnel Stages</TabsTrigger>
        <TabsTrigger value="team">Team</TabsTrigger>
      </TabsList>

      <TabsContent value="general" className="mt-4">
        <div className="grid gap-6">
          <GeneralForm settings={settings} />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ReceiptText className="size-4 text-muted-foreground" />
                Tax settings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button variant="outline" nativeButton={false} render={<Link href="/tax-settings" />}>
                Manage tax rates
                <ArrowRight className="size-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="numbering" className="mt-4">
        <NumberingForm settings={settings} />
      </TabsContent>

      <TabsContent value="industries" className="mt-4">
        <IndustriesCard industries={settings.industries} />
      </TabsContent>

      <TabsContent value="stages" className="mt-4">
        <FunnelStagesCard funnel={funnel} />
      </TabsContent>

      <TabsContent value="team" className="mt-4">
        <TeamTable members={members} />
      </TabsContent>
    </Tabs>
  )
}
