"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { MAX_INTERCOMPANY_PARTIES } from "@/lib/interco-share"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { groupCustomFields, type CustomFunnelField } from "@/lib/stage-gate"
import { showActionError } from "@/lib/show-action-error"
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Combobox } from "@/components/ui/combobox"
import { AccountQuickCreate } from "@/components/quick-create-account"
import { ContactQuickCreate } from "@/components/quick-create-contact"
import { useOpenOnNewParam } from "@/hooks/use-open-on-new-param"
import type { Option, MemberOption, FunnelWithStages } from "@/lib/lookups"
import {
  createOpportunity,
  updateOpportunity,
  type OpportunityListRow,
} from "./actions"

import { DEFAULT_CURRENCIES } from "@/lib/tenant-defaults"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  accountId: z.string().min(1, "Account is required"),
  primaryPersonId: z.string().optional(),
  pipelineId: z.string().min(1, "Funnel is required"),
  currentStageId: z.string().min(1, "Stage is required"),
  ownerMemberId: z.string().min(1, "Owner is required"),
  currency: z.string().min(1, "Currency is required"),
  natureCodes: z.array(z.string()),
  expectedCloseDate: z.string().optional(),
  estimatedAmount: z.string().optional(),
  recognizedPercent: z
    .string()
    .optional()
    .refine(
      (v) => !v || (Number(v) >= 0 && Number(v) <= 100),
      "Recognized % must be between 0 and 100"
    ),
  projectYear: z.string().optional(),
  description: z.string().optional(),
  isIntercompany: z.boolean().optional(),
  parties: z
    .array(
      z.object({
        partnerEntityId: z.string().min(1, "Pick a partner entity"),
        shareType: z.enum(["percent", "amount"]),
        shareValue: z
          .string()
          .min(1, "Required")
          .refine((v) => Number(v) > 0, "Must be greater than 0"),
      })
    )
    .max(MAX_INTERCOMPANY_PARTIES, `At most ${MAX_INTERCOMPANY_PARTIES} parties`),
  customFields: z.record(z.string(), z.string()),
})

type FormValues = z.infer<typeof schema>

export function OpportunityForm({
  mode,
  accounts,
  persons,
  members,
  pipelines,
  projectNatures = [],
  customFieldDefs = [],
  entityOptions = [],
  financeEnabled = false,
  currencies = DEFAULT_CURRENCIES,
  defaultOwnerMemberId,
  opportunity,
  opportunityId,
  presetAccountId,
  trigger,
}: {
  mode: "create" | "edit"
  accounts: Option[]
  persons: (Option & { accountId: string })[]
  members: MemberOption[]
  pipelines: FunnelWithStages[]
  /** Tenant project-nature picklist (code + name) from listProjectNatures(). */
  projectNatures?: { code: string; name: string }[]
  /** Tenant custom funnel fields to capture on the funnel. */
  customFieldDefs?: CustomFunnelField[]
  /** Other entities the user belongs to — the only valid intercompany partners. */
  entityOptions?: Option[]
  /** Whether the finance plugin (intercompany billing) is enabled. */
  financeEnabled?: boolean
  /** Tenant currency picklist (Settings → General); first = default. */
  currencies?: string[]
  defaultOwnerMemberId: string | null
  opportunity?: OpportunityListRow
  /**
   * Creating a Funnel under an existing Opportunity container (e.g. from its
   * Funnels tab) — account/PPVVC/nature all cascade down from the container,
   * so those fields are locked to it instead of being entered here.
   */
  opportunityId?: string
  /** Default the Account picker (create mode) — e.g. "New funnel" from an
   *  account's detail page. Unlike opportunityId, the picker stays editable. */
  presetAccountId?: string
  trigger?: React.ReactElement
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  // Auto-open from the header "+ New" quick-create deep link (/funnel?new=1).
  // Only the create form responds; edit instances ignore the flag.
  useOpenOnNewParam(() => setOpen(true), mode === "create")

  // Once a primary quotation exists its currency is frozen, so the opportunity
  // currency must not diverge — the server rejects it and the field is locked.
  const currencyLocked = mode === "edit" && !!opportunity?.primaryQuotationId

  // The primary quotation (net of tax) is the single source of truth for a
  // funnel's value, so the form has no manual Amount input. On create the value
  // is left unset (null); thereafter it syncs from the quote.

  // Resolve the default funnel + its first OPEN stage by sortOrder.
  const defaultFunnel =
    pipelines.find((f) => f.isDefault) ?? pipelines[0] ?? null
  const firstOpenStage = defaultFunnel
    ? [...defaultFunnel.stages]
        .filter((s) => s.kind === "OPEN")
        .sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? defaultFunnel.stages[0]
    : undefined

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: opportunity
      ? {
          name: opportunity.name,
          accountId: opportunity.accountId,
          primaryPersonId: "",
          pipelineId: opportunity.pipelineId,
          currentStageId: opportunity.stageId,
          ownerMemberId: opportunity.ownerMemberId,
          currency: opportunity.currency ?? "MYR",
          natureCodes:
            opportunity.projectNatures ??
            (opportunity.projectNatureCode
              ? [opportunity.projectNatureCode]
              : []),
          expectedCloseDate: opportunity.expectedCloseDate ?? "",
          estimatedAmount: opportunity.estimatedAmount ?? "",
          recognizedPercent: opportunity.recognizedPercent ?? "",
          projectYear:
            opportunity.projectYear != null
              ? String(opportunity.projectYear)
              : "",
          description: opportunity.description ?? "",
          isIntercompany: opportunity.isIntercompany ?? false,
          parties: opportunity.parties.map((p) => ({
            partnerEntityId: p.partnerEntityId,
            shareType: p.shareType,
            shareValue: p.shareValue,
          })),
          customFields: { ...(opportunity.customFields ?? {}) },
        }
      : {
          name: "",
          accountId: opportunityId
            ? (accounts[0]?.id ?? "")
            : (presetAccountId ?? ""),
          primaryPersonId: "",
          pipelineId: defaultFunnel?.id ?? "",
          currentStageId: firstOpenStage?.id ?? "",
          ownerMemberId: defaultOwnerMemberId ?? "",
          currency: currencies[0] ?? "MYR",
          natureCodes: [],
          expectedCloseDate: "",
          estimatedAmount: "",
          recognizedPercent: "",
          projectYear: "",
          description: "",
          isIntercompany: false,
          parties: [],
          customFields: {},
        },
  })

  const partyFields = useFieldArray({ control: form.control, name: "parties" })

  const selectedAccountId = form.watch("accountId")
  const selectedFunnelId = form.watch("pipelineId")

  // Picker options become local state seeded from props so inline "+ Create"
  // can append the new record and have it be immediately selectable.
  const [accountOptions, setAccountOptions] = React.useState(accounts)
  const [allPersons, setAllPersons] = React.useState(persons)

  // Inline quick-create dialog state for the Account / Contact pickers.
  const [accountCreate, setAccountCreate] = React.useState<{
    open: boolean
    name: string
  }>({ open: false, name: "" })
  const [contactCreate, setContactCreate] = React.useState<{
    open: boolean
    name: string
  }>({ open: false, name: "" })

  const personOptions = React.useMemo(
    () => allPersons.filter((p) => p.accountId === selectedAccountId),
    [allPersons, selectedAccountId]
  )
  const stageOptions = React.useMemo(() => {
    const f = pipelines.find((x) => x.id === selectedFunnelId)
    if (!f) return []
    const sorted = [...f.stages].sort((a, b) => a.sortOrder - b.sortOrder)
    // SF "Only_0E_During_Funnel_Creation": a new Funnel can only start at its
    // pipeline's first OPEN stage — don't offer a choice the server will reject.
    if (mode === "create") {
      const first = sorted.find((s) => s.kind === "OPEN")
      return first ? [first] : sorted
    }
    return sorted
  }, [pipelines, selectedFunnelId, mode])

  async function onSubmit(values: FormValues) {
    if (mode === "create") {
      const res = await createOpportunity({
        opportunityId,
        name: values.name,
        accountId: values.accountId,
        primaryPersonId: values.primaryPersonId || null,
        pipelineId: values.pipelineId,
        currentStageId: values.currentStageId,
        ownerMemberId: values.ownerMemberId,
        currency: values.currency,
        projectNatures: values.natureCodes,
        expectedCloseDate: values.expectedCloseDate || null,
        estimatedAmount: values.estimatedAmount || null,
        recognizedPercent: values.recognizedPercent || null,
        projectYear: values.projectYear ? Number(values.projectYear) : null,
        description: values.description || null,
        isIntercompany: !!values.isIntercompany,
        parties: values.isIntercompany ? values.parties : [],
        customFields: values.customFields,
      })
      if (!res.ok) {
        showActionError(res)
        return
      }
      toast.success("Funnel created")
      setOpen(false)
      router.push(`/funnel/${res.data.id}`)
    } else if (opportunity) {
      const res = await updateOpportunity(opportunity.id, {
        name: values.name,
        accountId: values.accountId,
        primaryPersonId: values.primaryPersonId || null,
        ownerMemberId: values.ownerMemberId,
        currency: values.currency,
        projectNatures: values.natureCodes,
        expectedCloseDate: values.expectedCloseDate || null,
        estimatedAmount: values.estimatedAmount || null,
        recognizedPercent: values.recognizedPercent || null,
        projectYear: values.projectYear ? Number(values.projectYear) : null,
        description: values.description || null,
        isIntercompany: !!values.isIntercompany,
        parties: values.isIntercompany ? values.parties : [],
        customFields: values.customFields,
      })
      if (!res.ok) {
        showActionError(res)
        return
      }
      toast.success("Funnel updated")
      setOpen(false)
      router.refresh()
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={trigger ?? <Button>New Funnel</Button>}
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New Funnel" : "Edit Funnel"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a Funnel and choose its stage."
              : "Update this Funnel's details."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme renewal" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Account</FormLabel>
                    <FormControl>
                      <Combobox
                        value={field.value}
                        onChange={(v) => {
                          field.onChange(v)
                          form.setValue("primaryPersonId", "")
                        }}
                        disabled={!!opportunityId}
                        options={accountOptions.map((a) => ({
                          value: a.id,
                          label: a.name,
                        }))}
                        placeholder="Pick an account…"
                        searchPlaceholder="Search accounts…"
                        emptyMessage="No accounts found."
                        onCreate={(q) =>
                          setAccountCreate({ open: true, name: q })
                        }
                      />
                    </FormControl>
                    {opportunityId ? (
                      <FormDescription>
                        Inherited from the parent Opportunity.
                      </FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="primaryPersonId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primary contact</FormLabel>
                    <FormControl>
                      <Combobox
                        value={field.value || ""}
                        onChange={field.onChange}
                        disabled={!selectedAccountId}
                        options={personOptions.map((p) => ({
                          value: p.id,
                          label: p.name,
                        }))}
                        placeholder={
                          !selectedAccountId
                            ? "Pick an account first"
                            : "Optional"
                        }
                        searchPlaceholder="Search contacts…"
                        emptyMessage="No contacts for this account."
                        onCreate={(q) =>
                          setContactCreate({ open: true, name: q })
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* With a single pipeline there is nothing to choose — the funnel
                and its first stage are already defaulted, so just say so
                instead of showing a one-option picker + a locked stage. */}
            {mode === "create" && pipelines.length === 1 ? (
              <p className="text-sm text-muted-foreground">
                Starts in{" "}
                <span className="font-medium text-foreground">
                  {defaultFunnel?.name}
                </span>
                {firstOpenStage ? (
                  <>
                    {" "}at{" "}
                    <span className="font-medium text-foreground">
                      {firstOpenStage.name}
                    </span>
                  </>
                ) : null}
                .
              </p>
            ) : null}

            {mode === "create" && pipelines.length > 1 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="pipelineId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Funnel</FormLabel>
                      <FormControl>
                        <Combobox
                          value={field.value}
                          onChange={(v) => {
                            field.onChange(v)
                            const f = pipelines.find((x) => x.id === v)
                            const first = f
                              ? [...f.stages]
                                  .filter((s) => s.kind === "OPEN")
                                  .sort(
                                    (a, b) => a.sortOrder - b.sortOrder
                                  )[0] ?? f.stages[0]
                              : undefined
                            form.setValue("currentStageId", first?.id ?? "")
                          }}
                          options={pipelines.map((f) => ({
                            value: f.id,
                            label: `${f.name}${f.isDefault ? " (default)" : ""}`,
                          }))}
                          placeholder="Pick a funnel…"
                          searchPlaceholder="Search pipelines…"
                          emptyMessage="No pipelines found."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="currentStageId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Stage</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={!selectedFunnelId}
                        items={stageOptions.map((s) => ({
                          value: s.id,
                          label: s.name,
                        }))}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pick a stage…" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {stageOptions.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ) : null}

            <FormField
              control={form.control}
              name="ownerMemberId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Owner</FormLabel>
                  <FormControl>
                    <Combobox
                      value={field.value}
                      onChange={field.onChange}
                      options={members.map((m) => ({
                        value: m.memberId,
                        label: m.name,
                      }))}
                      placeholder="Pick an owner…"
                      searchPlaceholder="Search members…"
                      emptyMessage="No members found."
                    />
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
                    disabled={currencyLocked}
                    items={currencies.map((c) => ({ value: c, label: c }))}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a currency…" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {currencies.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {currencyLocked
                      ? "Locked to the primary quotation's currency."
                      : "The Funnel's value is set by its primary quotation (net)."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="natureCodes"
              render={({ field }) => {
                if (opportunityId) return <></>
                const selected = field.value ?? []
                // Single-select: picking replaces; re-clicking clears.
                const toggle = (code: string) =>
                  field.onChange(selected.includes(code) ? [] : [code])
                return (
                  <FormItem>
                    <FormLabel>Opportunity Nature</FormLabel>
                    {projectNatures.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No project natures configured. Add them in Settings.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {projectNatures.map((p) => {
                          const on = selected.includes(p.code)
                          return (
                            <button
                              key={p.code}
                              type="button"
                              onClick={() => toggle(p.code)}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                                on
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-input bg-background text-muted-foreground hover:bg-accent"
                              )}
                            >
                              {p.name}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    <FormDescription>
                      Drives the nature segment of the project code.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )
              }}
            />

            {/* Custom fields are captured progressively when advancing stages
                (each stage asks only for what it needs), so the create form
                stays lean — only edit exposes them for later corrections. */}
            {mode === "edit" && customFieldDefs.length > 0 ? (
              <div className="grid gap-4 rounded-md border p-3">
                {groupCustomFields(customFieldDefs).map((group) => (
                  <div key={group.category ?? "__none__"} className="grid gap-3">
                    {group.category ? (
                      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {group.category}
                      </p>
                    ) : null}
                    {group.fields.map((def) => (
                  <FormField
                    key={def.key}
                    control={form.control}
                    name={`customFields.${def.key}` as `customFields.${string}`}
                    render={({ field }) =>
                      def.type === "checkbox" ? (
                        <FormItem className="flex flex-row items-start gap-2 space-y-0">
                          <FormControl>
                            <Checkbox
                              className="mt-0.5"
                              checked={field.value === "true"}
                              onCheckedChange={(c) =>
                                field.onChange(c ? "true" : "false")
                              }
                            />
                          </FormControl>
                          <div className="grid gap-0.5">
                            <FormLabel className="text-sm font-normal">
                              {def.label}
                            </FormLabel>
                            {def.description ? (
                              <p className="text-xs text-muted-foreground">
                                {def.description}
                              </p>
                            ) : null}
                          </div>
                        </FormItem>
                      ) : (
                        <FormItem>
                          <FormLabel className="text-xs font-normal text-muted-foreground">
                            {def.label}
                          </FormLabel>
                          <FormControl>
                            {def.type === "select" ? (
                              <Select
                                value={field.value || ""}
                                onValueChange={field.onChange}
                                items={(def.options ?? []).map((o) => ({
                                  value: o,
                                  label: o,
                                }))}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(def.options ?? []).map((o) => (
                                    <SelectItem key={o} value={o}>
                                      {o}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                type={
                                  def.type === "number"
                                    ? "number"
                                    : def.type === "date"
                                      ? "date"
                                      : "text"
                                }
                                {...field}
                                value={field.value ?? ""}
                              />
                            )}
                          </FormControl>
                          {def.description ? (
                            <p className="text-xs text-muted-foreground">
                              {def.description}
                            </p>
                          ) : null}
                        </FormItem>
                      )
                    }
                  />
                    ))}
                  </div>
                ))}
              </div>
            ) : null}

            <FormField
              control={form.control}
              name="expectedCloseDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Expected close date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="estimatedAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estimated funnel amount</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="projectYear"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project / license year</FormLabel>
                    <FormControl>
                      <Input type="number" min="2000" max="2100" placeholder="2024" {...field} />
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
                  <FormLabel>Funnel description</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Optional notes about this deal…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {financeEnabled ? (
              <FormField
                control={form.control}
                name="isIntercompany"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div className="grid gap-0.5">
                      <FormLabel>Intercompany deal</FormLabel>
                      <FormDescription>
                        A partner entity handles delivery; we&apos;re the
                        contracting middle-man and recognize only our cut.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={!!field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            ) : null}

            {financeEnabled && form.watch("isIntercompany") ? (
              <div className="grid gap-3 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <FormLabel>
                    Handling partner{partyFields.fields.length !== 1 ? "s" : ""}
                  </FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={partyFields.fields.length >= MAX_INTERCOMPANY_PARTIES}
                    onClick={() =>
                      partyFields.append({
                        partnerEntityId: "",
                        shareType: "amount",
                        shareValue: "",
                      })
                    }
                  >
                    <Plus className="size-4" /> Add party
                  </Button>
                </div>
                <FormDescription>
                  Other entities that handle delivery — not external customers.
                  Our recognized cut = deal value − all parties&apos; shares.
                </FormDescription>

                {partyFields.fields.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No parties yet — add one above.
                  </p>
                ) : (
                  partyFields.fields.map((field, index) => {
                    const chosenElsewhere = form
                      .watch("parties")
                      .filter((_, i) => i !== index)
                      .map((p) => p.partnerEntityId)
                    return (
                      <div
                        key={field.id}
                        className="grid grid-cols-[1fr_auto_1fr_auto] items-start gap-2"
                      >
                        <FormField
                          control={form.control}
                          name={`parties.${index}.partnerEntityId`}
                          render={({ field: f }) => (
                            <FormItem>
                              <FormControl>
                                <Combobox
                                  value={f.value ?? ""}
                                  onChange={(v) => f.onChange(v || "")}
                                  options={entityOptions
                                    .filter((e) => !chosenElsewhere.includes(e.id))
                                    .map((e) => ({ value: e.id, label: e.name }))}
                                  placeholder={
                                    entityOptions.length
                                      ? "Select entity"
                                      : "No other entities available"
                                  }
                                  searchPlaceholder="Search entities…"
                                  emptyMessage="No other entities. Intercompany transfers only go to your own entities."
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`parties.${index}.shareType`}
                          render={({ field: f }) => (
                            <FormItem>
                              <Select value={f.value} onValueChange={f.onChange}>
                                <FormControl>
                                  <SelectTrigger className="w-[90px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="amount">Amount</SelectItem>
                                  <SelectItem value="percent">Percent</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`parties.${index}.shareValue`}
                          render={({ field: f }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder={
                                    form.watch(`parties.${index}.shareType`) === "percent"
                                      ? "0-100%"
                                      : `0.00 ${form.watch("currency")}`
                                  }
                                  {...f}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove party"
                          onClick={() => partyFields.remove(index)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )
                  })
                )}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {mode === "create" ? "Create" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>

      <AccountQuickCreate
        open={accountCreate.open}
        onOpenChange={(o) => setAccountCreate((s) => ({ ...s, open: o }))}
        defaultName={accountCreate.name}
        onCreated={(rec) => {
          setAccountOptions((prev) => [...prev, rec])
          form.setValue("accountId", rec.id)
          form.setValue("primaryPersonId", "")
        }}
      />
      <ContactQuickCreate
        open={contactCreate.open}
        onOpenChange={(o) => setContactCreate((s) => ({ ...s, open: o }))}
        accountId={selectedAccountId}
        defaultName={contactCreate.name}
        onCreated={(rec) => {
          setAllPersons((prev) => [
            ...prev,
            { ...rec, accountId: selectedAccountId },
          ])
          form.setValue("primaryPersonId", rec.id)
        }}
      />
    </>
  )
}
