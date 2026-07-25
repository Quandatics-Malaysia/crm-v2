"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { showActionError } from "@/lib/show-action-error"
import { ArrowUp, ArrowDown, Plus, Trash2, X } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

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
import { Checkbox } from "@/components/ui/checkbox"
import {
  CUSTOM_FIELD_TYPES,
  groupCustomFields,
  type CustomFunnelField,
  type CustomFieldType,
} from "@/lib/stage-gate"
import { Badge } from "@/components/ui/badge"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { EmptyState } from "@/components/empty-state"
import {
  updateCustomFunnelFields,
  updateStage,
  createStage,
  deleteStage,
  reorderStages,
  type DefaultFunnelView,
  type FunnelStageRow,
} from "@/app/(app)/settings/actions"
import {
  STAGE_CODES,
  STAGE_KINDS,
  STAGE_CODE_LABELS,
  STAGE_KIND_LABELS,
  suggestKindForCode,
  defaultIncludeInForecast,
} from "@/app/(app)/settings/constants"
import type { StageCode, StageKind } from "@/app/(app)/settings/constants"

// ─── Custom funnel fields ───────────────────────────────────────────────────

function CustomFunnelFieldsCard({ fields }: { fields: CustomFunnelField[] }) {
  const [items, setItems] = React.useState<CustomFunnelField[]>(fields)
  const [labelDraft, setLabelDraft] = React.useState("")
  const [typeDraft, setTypeDraft] = React.useState<CustomFieldType>("text")
  const [optionsDraft, setOptionsDraft] = React.useState("")
  const [descDraft, setDescDraft] = React.useState("")
  const [categoryDraft, setCategoryDraft] = React.useState("")
  const [isPending, startTransition] = React.useTransition()

  const dirty = React.useMemo(() => {
    if (items.length !== fields.length) return true
    return items.some(
      (v, i) =>
        v.key !== fields[i].key ||
        v.label !== fields[i].label ||
        (v.type ?? "text") !== (fields[i].type ?? "text") ||
        (v.description ?? "") !== (fields[i].description ?? "") ||
        (v.category ?? "") !== (fields[i].category ?? "") ||
        (v.options ?? []).join("|") !== (fields[i].options ?? []).join("|")
    )
  }, [items, fields])

  const grouped = React.useMemo(() => groupCustomFields(items), [items])

  const typeLabel = (t?: CustomFieldType) =>
    CUSTOM_FIELD_TYPES.find((x) => x.value === (t ?? "text"))?.label ?? "Text"

  function add() {
    const label = labelDraft.trim()
    if (!label) {
      toast.error("Enter a field name.")
      return
    }
    if (items.some((v) => v.label.toLowerCase() === label.toLowerCase())) {
      toast.error(`"${label}" is already in the list.`)
      return
    }
    const options =
      typeDraft === "select"
        ? optionsDraft.split(",").map((o) => o.trim()).filter(Boolean)
        : undefined
    if (typeDraft === "select" && (!options || options.length === 0)) {
      toast.error("Add at least one dropdown option (comma-separated).")
      return
    }
    const description = descDraft.trim() || undefined
    const category = categoryDraft.trim() || undefined
    // Blank key → the server slugs a stable `cf_…` key on save.
    setItems((prev) => [
      ...prev,
      {
        key: "",
        label,
        type: typeDraft,
        ...(options ? { options } : {}),
        ...(description ? { description } : {}),
        ...(category ? { category } : {}),
      },
    ])
    setLabelDraft("")
    setOptionsDraft("")
    setDescDraft("")
    // Keep the category so several fields can be added to the same section fast.
    setTypeDraft("text")
  }

  function remove(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function save() {
    startTransition(async () => {
      const res = await updateCustomFunnelFields(
        items.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type ?? "text",
          options: f.options,
          description: f.description,
          category: f.category,
        }))
      )
      if (!res.ok) {
        showActionError(res)
        return
      }
      setItems(res.data)
      toast.success("Custom fields saved")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom funnel fields</CardTitle>
        <CardDescription>
          Your own fields that salespeople fill on each funnel — text, number,
          date, a yes/no checkbox, or a dropdown. Require any per stage under
          Funnel stages below; the gate blocks advancing until they&apos;re
          filled in.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
          <p className="text-sm font-medium">Add a field</p>
          <div className="grid gap-1.5">
            <label className="text-xs text-muted-foreground">
              Section (optional)
            </label>
            <Input
              value={categoryDraft}
              onChange={(e) => setCategoryDraft(e.target.value)}
              placeholder="e.g. Power Sponsor — groups fields together"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label className="text-xs text-muted-foreground">Field name</label>
              <Input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                placeholder="e.g. Budget confirmed"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs text-muted-foreground">Type</label>
              <Select
                value={typeDraft}
                onValueChange={(v) => setTypeDraft(v as CustomFieldType)}
                items={CUSTOM_FIELD_TYPES}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_FIELD_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {typeDraft === "select" ? (
            <div className="grid gap-1.5">
              <label className="text-xs text-muted-foreground">
                Dropdown choices
              </label>
              <Input
                value={optionsDraft}
                onChange={(e) => setOptionsDraft(e.target.value)}
                placeholder="Comma-separated, e.g. Low, Medium, High"
              />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <label className="text-xs text-muted-foreground">
              Help text (optional)
            </label>
            <Input
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              placeholder="Shown under the field on the funnel"
            />
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={add}>
              <Plus className="size-4" />
              Add field
            </Button>
          </div>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-4">
            {grouped.map((g) => (
              <div key={g.category ?? "__none__"} className="grid gap-2">
                {g.category ? (
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {g.category}
                  </p>
                ) : null}
                {g.fields.map((f) => {
                  const i = items.indexOf(f)
                  return (
                    <div
                      key={f.key || f.label}
                      className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <div className="grid min-w-0 gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{f.label}</span>
                          <Badge
                            variant="outline"
                            className="text-xs font-normal"
                          >
                            {typeLabel(f.type)}
                          </Badge>
                          {f.type === "select" && f.options?.length ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {f.options.join(" · ")}
                            </span>
                          ) : null}
                        </div>
                        {f.description ? (
                          <span className="text-xs text-muted-foreground">
                            {f.description}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        className="ml-auto rounded-sm p-0.5 text-muted-foreground hover:bg-muted-foreground/20"
                        aria-label={`Remove ${f.label}`}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No custom fields yet." />
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : "Save custom fields"}
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
  requiredFields: z.array(z.string()),
})

type StageValues = z.input<typeof stageSchema>

const KIND_OPTIONS = STAGE_KINDS.map((k) => ({
  value: k,
  label: STAGE_KIND_LABELS[k],
}))

function StageDialog({
  open,
  onOpenChange,
  initial,
  usedCodes,
  nextSortOrder,
  customFields,
  trigger,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial?: FunnelStageRow
  usedCodes: StageCode[]
  nextSortOrder: number
  /** Tenant custom funnel fields — requirable alongside the presets. */
  customFields: CustomFunnelField[]
  trigger?: React.ReactNode
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)

  // Only the tenant's own custom fields can be required at a stage.
  const requirableEntries = React.useMemo(
    () => customFields.map((f) => [f.key, f.label] as const),
    [customFields]
  )

  const availableCodes = React.useMemo(
    () =>
      STAGE_CODES.filter(
        (c) => initial?.code === c || !usedCodes.includes(c)
      ).map((c) => ({ value: c, label: STAGE_CODE_LABELS[c] })),
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
      requiredFields: initial?.requiredFields ?? [],
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
        requiredFields: initial?.requiredFields ?? [],
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function onSubmit(raw: StageValues) {
    const parsed = stageSchema.parse(raw)
    setSaving(true)
    const res = initial
      ? await updateStage(initial.id, {
          name: parsed.name,
          probability: parsed.probability,
          requiresApprovalToEnter: parsed.requiresApprovalToEnter,
          includeInForecast: parsed.includeInForecast,
          sortOrder: parsed.sortOrder,
          requiredFields: parsed.requiredFields,
        })
      : await createStage({
          code: parsed.code,
          kind: parsed.kind,
          name: parsed.name,
          probability: parsed.probability,
          requiresApprovalToEnter: parsed.requiresApprovalToEnter,
          includeInForecast: parsed.includeInForecast,
          sortOrder: parsed.sortOrder,
          requiredFields: parsed.requiredFields,
        })
    setSaving(false)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success(initial ? "Stage updated" : "Stage created")
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit stage" : "New stage"}</DialogTitle>
          <DialogDescription>Configure this funnel stage.</DialogDescription>
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
                      onValueChange={(v) => {
                        field.onChange(v)
                        // Auto-fill the locked semantics + forecast default to
                        // match the chosen code (create only).
                        if (!initial) {
                          const kind = suggestKindForCode(v as StageCode)
                          form.setValue("kind", kind)
                          form.setValue(
                            "includeInForecast",
                            defaultIncludeInForecast(kind)
                          )
                        }
                      }}
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
                      onValueChange={(v) => {
                        field.onChange(v)
                        // Keep the forecast default in step with the Kind.
                        if (!initial) {
                          form.setValue(
                            "includeInForecast",
                            defaultIncludeInForecast(v as StageKind)
                          )
                        }
                      }}
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
                <FormItem className="flex flex-row items-center justify-between gap-4 space-y-0">
                  <FormLabel className="font-normal">
                    Requires approval to enter
                  </FormLabel>
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
                <FormItem className="flex flex-row items-center justify-between gap-4 space-y-0">
                  <FormLabel className="font-normal">Include in forecast</FormLabel>
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
              name="requiredFields"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Required before entering this stage</FormLabel>
                  <FormDescription>
                    Custom fields a funnel must fill in first.
                  </FormDescription>
                  {requirableEntries.length === 0 ? (
                    <p className="pt-1 text-sm text-muted-foreground">
                      No custom fields yet — add some under “Custom funnel
                      fields” first.
                    </p>
                  ) : (
                    <div className="grid gap-2 pt-1 sm:grid-cols-2">
                      {requirableEntries.map(([key, label]) => {
                        const checked = field.value.includes(key)
                        return (
                          <label
                            key={key}
                            className="flex items-center gap-2 text-sm"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) =>
                                field.onChange(
                                  c
                                    ? [...field.value, key]
                                    : field.value.filter(
                                        (k: string) => k !== key
                                      )
                                )
                              }
                            />
                            {label}
                          </label>
                        )
                      })}
                    </div>
                  )}
                  <FormMessage />
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
  customFields,
}: {
  stage: FunnelStageRow
  usedCodes: StageCode[]
  nextSortOrder: number
  index: number
  total: number
  onMove: (index: number, dir: -1 | 1) => void
  customFields: CustomFunnelField[]
}) {
  const router = useRouter()
  const [editOpen, setEditOpen] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function onDelete() {
    setBusy(true)
    const res = await deleteStage(stage.id)
    setBusy(false)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Stage deleted")
    setConfirmOpen(false)
    router.refresh()
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
        onClick={() => setConfirmOpen(true)}
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
        customFields={customFields}
      />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete stage?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the “{stage.name}” stage from the funnel.
              Stages that still have pipelines in them can&apos;t be deleted —
              move those pipelines to another stage first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function FunnelStagesCard({
  funnel,
  customFields,
}: {
  funnel: DefaultFunnelView
  customFields: CustomFunnelField[]
}) {
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
      const res = await reorderStages(order)
      setReordering(false)
      if (!res.ok) {
        showActionError(res)
        return
      }
      toast.success("Order saved")
      router.refresh()
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
          <Badge
            variant="outline"
            className="font-mono text-[10px]"
            title={STAGE_CODE_LABELS[row.original.code as StageCode] ?? row.original.code}
          >
            {row.original.code}
          </Badge>
        </div>
      ),
    },
    {
      accessorKey: "kind",
      header: "Kind",
      cell: ({ row }) => (
        <Badge variant="secondary">
          {STAGE_KIND_LABELS[row.original.kind as StageKind] ??
            row.original.kind}
        </Badge>
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
          customFields={customFields}
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
                customFields={customFields}
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

// ─── Shell ───────────────────────────────────────────────────────────────────

export function FunnelStagesClient({
  funnel,
  customFields,
}: {
  funnel: DefaultFunnelView
  customFields: CustomFunnelField[]
}) {
  return (
    <div className="grid gap-4">
      <FunnelStagesCard funnel={funnel} customFields={customFields} />
      <CustomFunnelFieldsCard fields={customFields} />
    </div>
  )
}
