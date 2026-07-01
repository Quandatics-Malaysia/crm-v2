"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { groupCustomFields, type CustomFunnelField } from "@/lib/stage-gate"
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

/** Common ISO-4217 currencies offered in the picker (default is the first). */
const CURRENCIES = [
  "MYR",
  "USD",
  "SGD",
  "EUR",
  "GBP",
  "AUD",
  "JPY",
  "CNY",
  "HKD",
  "IDR",
  "THB",
  "PHP",
  "VND",
  "INR",
  "AED",
] as const

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  accountId: z.string().min(1, "Account is required"),
  primaryPersonId: z.string().optional(),
  funnelId: z.string().min(1, "Funnel is required"),
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
  handlingPartnerEntityId: z.string().optional(),
  customFields: z.record(z.string(), z.string()),
})

type FormValues = z.infer<typeof schema>

export function OpportunityForm({
  mode,
  accounts,
  persons,
  members,
  funnels,
  projectNatures = [],
  customFieldDefs = [],
  entityOptions = [],
  defaultOwnerMemberId,
  opportunity,
  trigger,
}: {
  mode: "create" | "edit"
  accounts: Option[]
  persons: (Option & { accountId: string })[]
  members: MemberOption[]
  funnels: FunnelWithStages[]
  /** Tenant project-nature picklist (code + name) from listProjectNatures(). */
  projectNatures?: { code: string; name: string }[]
  /** Tenant custom funnel fields to capture on the funnel. */
  customFieldDefs?: CustomFunnelField[]
  /** Other entities the user belongs to — the only valid intercompany partners. */
  entityOptions?: Option[]
  defaultOwnerMemberId: string | null
  opportunity?: OpportunityListRow
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
    funnels.find((f) => f.isDefault) ?? funnels[0] ?? null
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
          funnelId: opportunity.funnelId,
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
          handlingPartnerEntityId: opportunity.handlingPartnerEntityId ?? "",
          customFields: { ...(opportunity.customFields ?? {}) },
        }
      : {
          name: "",
          accountId: "",
          primaryPersonId: "",
          funnelId: defaultFunnel?.id ?? "",
          currentStageId: firstOpenStage?.id ?? "",
          ownerMemberId: defaultOwnerMemberId ?? "",
          currency: "MYR",
          natureCodes: [],
          expectedCloseDate: "",
          estimatedAmount: "",
          recognizedPercent: "",
          projectYear: "",
          description: "",
          isIntercompany: false,
          handlingPartnerEntityId: "",
          customFields: {},
        },
  })

  const selectedAccountId = form.watch("accountId")
  const selectedFunnelId = form.watch("funnelId")

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
    const f = funnels.find((x) => x.id === selectedFunnelId)
    return f ? [...f.stages].sort((a, b) => a.sortOrder - b.sortOrder) : []
  }, [funnels, selectedFunnelId])

  async function onSubmit(values: FormValues) {
    if (mode === "create") {
      const res = await createOpportunity({
        name: values.name,
        accountId: values.accountId,
        primaryPersonId: values.primaryPersonId || null,
        funnelId: values.funnelId,
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
        handlingPartnerEntityId: values.handlingPartnerEntityId || null,
        customFields: values.customFields,
      })
      if (!res.ok) {
        toast.error(res.error)
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
        handlingPartnerEntityId: values.handlingPartnerEntityId || null,
        customFields: values.customFields,
      })
      if (!res.ok) {
        toast.error(res.error)
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

            {mode === "create" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="funnelId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Funnel</FormLabel>
                      <FormControl>
                        <Combobox
                          value={field.value}
                          onChange={(v) => {
                            field.onChange(v)
                            const f = funnels.find((x) => x.id === v)
                            const first = f
                              ? [...f.stages]
                                  .filter((s) => s.kind === "OPEN")
                                  .sort(
                                    (a, b) => a.sortOrder - b.sortOrder
                                  )[0] ?? f.stages[0]
                              : undefined
                            form.setValue("currentStageId", first?.id ?? "")
                          }}
                          options={funnels.map((f) => ({
                            value: f.id,
                            label: `${f.name}${f.isDefault ? " (default)" : ""}`,
                          }))}
                          placeholder="Pick a funnel…"
                          searchPlaceholder="Search funnels…"
                          emptyMessage="No funnels found."
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
                    items={CURRENCIES.map((c) => ({ value: c, label: c }))}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a currency…" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
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
                const selected = field.value ?? []
                const toggle = (code: string) =>
                  field.onChange(
                    selected.includes(code)
                      ? selected.filter((c) => c !== code)
                      : [...selected, code]
                  )
                return (
                  <FormItem>
                    <FormLabel>Project nature(s)</FormLabel>
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
                      A deal can span several (e.g. License + PS + AMS). The first
                      selected is the primary nature used for the project code.
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

            {form.watch("isIntercompany") ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="handlingPartnerEntityId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Handling partner</FormLabel>
                      <FormControl>
                        <Combobox
                          value={field.value ?? ""}
                          onChange={(v) => field.onChange(v || "")}
                          options={entityOptions.map((e) => ({
                            value: e.id,
                            label: e.name,
                          }))}
                          placeholder={
                            entityOptions.length
                              ? "Select the partner entity"
                              : "No other entities available"
                          }
                          searchPlaceholder="Search entities…"
                          emptyMessage="No other entities. Intercompany transfers only go to your own entities."
                        />
                      </FormControl>
                      <FormDescription>
                        Another of your entities that handles delivery — not an
                        external customer.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="recognizedPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Recognized % (our cut)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" max="100" placeholder="10" {...field} />
                      </FormControl>
                      <FormDescription>
                        Recognized amount = estimated × this %.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
