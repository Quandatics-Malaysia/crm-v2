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
  Copy,
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  CUSTOM_FIELD_TYPES,
  groupCustomFields,
  type CustomFunnelField,
  type CustomFieldType,
} from "@/lib/stage-gate"
import { cn } from "@/lib/utils"
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
import {
  updateSettings,
  updateNumbering,
  updateIndustries,
  updateCountries,
  updateProjectNatures,
  updateProductCodes,
  updateCustomFunnelFields,
  updateStage,
  createStage,
  deleteStage,
  reorderStages,
  updateAutoJoin,
  updateIntercompanyPartners,
  updateCurrencies,
  updatePaymentTerms,
  updateLeadSources,
  updateLossReasons,
  updateSoDocumentKinds,
  updateMilestoneTemplate,
  updateInvoiceReminderDays,
  updateCompanyProfile,
  uploadCompanyLogo,
  removeCompanyLogo,
  type CompanyProfile,
} from "./actions"
import {
  DEFAULT_CURRENCIES,
  DEFAULT_PAYMENT_TERMS,
  DEFAULT_LEAD_SOURCES,
  DEFAULT_LOSS_REASONS,
  DEFAULT_SO_DOCUMENT_KINDS,
} from "@/lib/tenant-defaults"
import { Textarea } from "@/components/ui/textarea"
import type {
  TenantSettingsView,
  TenantMemberView,
  DefaultFunnelView,
  FunnelStageRow,
} from "./actions"
import {
  STAGE_CODES,
  STAGE_KINDS,
  STAGE_CODE_LABELS,
  STAGE_KIND_LABELS,
  suggestKindForCode,
  defaultIncludeInForecast,
  PROJECT_NATURE_CODE_MAX,
  normalizeProjectNatureCode,
  validateProjectNatureCode,
  PRODUCT_CODE_MAX,
  normalizeProductCode,
  validateProductCode,
  AUTO_JOIN_ROLES,
} from "./constants"
import type { StageCode, StageKind, ProjectNature, ProductCode } from "./constants"

// ─── General ─────────────────────────────────────────────────────────────────

const generalSchema = z.object({
  entityName: z.string().trim().min(1, "Entity name is required").max(120),
  defaultCurrency: z
    .string()
    .trim()
    .length(3, "Use a 3-letter ISO code")
    .transform((v) => v.toUpperCase()),
  fiscalYearStartMonth: z.coerce.number().int().min(1, "1–12").max(12, "1–12"),
  approvalBypassTier: z.coerce.number().int().min(0, "Must be ≥ 0"),
  followUpDueDays: z.coerce.number().int().min(1, "1–90").max(90, "1–90"),
  autoCreateProjectOnAccept: z.boolean(),
  autoCompleteProjectOnPaid: z.boolean(),
  intercoAutoMirror: z.boolean(),
  documentationModule: z.boolean(),
  /** Empty = feature off. */
  staleDealDays: z
    .string()
    .trim()
    .refine(
      (v) =>
        v === "" ||
        (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 365),
      "1–365 days"
    ),
  /** Empty = feature off. */
  leadFollowUpDays: z
    .string()
    .trim()
    .refine(
      (v) =>
        v === "" ||
        (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 365),
      "1–365 days"
    ),
  defaultCountry: z.string().trim().optional().default(""),
  phonePrefix: z.string().trim().max(8, "Keep it short").optional().default(""),
  entityCode: z.string().trim().max(16, "Keep it short").optional().default(""),
  taxInclusive: z.boolean(),
  autoWinOnQuoteAccept: z.boolean(),
  allowPasswordLogin: z.boolean(),
})

type GeneralValues = z.input<typeof generalSchema>
type GeneralParsed = z.output<typeof generalSchema>

const FINANCE_SWITCHES = new Set(["autoCompleteProjectOnPaid", "intercoAutoMirror"])

const SWITCHES: {
  name:
    | "taxInclusive"
    | "autoWinOnQuoteAccept"
    | "autoCreateProjectOnAccept"
    | "autoCompleteProjectOnPaid"
    | "intercoAutoMirror"
    | "documentationModule"
    | "allowPasswordLogin"
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
      "Move a funnel to Won automatically when its primary quote is accepted. Note: this bypasses the Won stage's \"requires approval to enter\" gate — accepting the quote wins the funnel directly, no sign-off requested.",
  },
  {
    name: "autoCreateProjectOnAccept",
    label: "Auto-create project on quote accept",
    description:
      "Create the delivery project automatically from an accepted quotation (value, currency and nature carried over; milestone template applied). Skipped with a warning when the account has no code yet.",
  },
  {
    name: "autoCompleteProjectOnPaid",
    label: "Auto-complete project when fully paid",
    description:
      "Move a project to Completed automatically once every payment milestone is paid (via billing receipts).",
  },
  {
    name: "intercoAutoMirror",
    label: "Auto-mirror intercompany invoices",
    description:
      "Issuing a customer invoice on an intercompany project drafts the pair automatically: the partner's sales invoice to you and your purchase invoice from them, for their share.",
  },
  {
    name: "documentationModule",
    label: "Documentation",
    description:
      "Allow the internal documentation site (/documentation — module guides, flow maps, schema reference). It is linked nowhere in the app and only members with the \"View the in-app documentation\" permission (Owner/Admin by default) can open it.",
  },
  {
    name: "allowPasswordLogin",
    label: "Allow password login",
    description:
      "Permit email + password sign-in for this organization. Turning this off requires another sign-in method (e.g. SSO) — with none configured, everyone is locked out.",
  },
]

function GeneralForm({
  settings,
  members,
}: {
  settings: TenantSettingsView
  members: TenantMemberView[]
}) {
  const [isPending, startTransition] = React.useTransition()
  const [confirmLockout, setConfirmLockout] = React.useState(false)
  const [pendingValues, setPendingValues] =
    React.useState<GeneralParsed | null>(null)

  const form = useForm<GeneralValues>({
    resolver: zodResolver(generalSchema),
    defaultValues: {
      entityName: settings.entityName,
      defaultCurrency: settings.defaultCurrency,
      fiscalYearStartMonth: settings.fiscalYearStartMonth,
      approvalBypassTier: settings.approvalBypassTier,
      followUpDueDays: settings.followUpDueDays,
      autoCreateProjectOnAccept: settings.autoCreateProjectOnAccept,
      autoCompleteProjectOnPaid: settings.autoCompleteProjectOnPaid,
      intercoAutoMirror: settings.intercoAutoMirror,
      documentationModule: settings.documentationModule,
      staleDealDays:
        settings.staleDealDays == null ? "" : String(settings.staleDealDays),
      leadFollowUpDays:
        settings.leadFollowUpDays == null
          ? ""
          : String(settings.leadFollowUpDays),
      defaultCountry: settings.defaultCountry,
      phonePrefix: settings.phonePrefix,
      entityCode: settings.entityCode,
      taxInclusive: settings.taxInclusive,
      autoWinOnQuoteAccept: settings.autoWinOnQuoteAccept,
      allowPasswordLogin: settings.allowPasswordLogin,
    },
  })

  // Highest tier held by an active member — used to flag a deadlocked bypass tier.
  const maxActiveTier = React.useMemo(
    () =>
      members
        .filter((m) => m.status === "active")
        .reduce((max, m) => Math.max(max, m.tierLevel), -1),
    [members]
  )
  const bypassTier = Number(useWatch({ control: form.control, name: "approvalBypassTier" })) || 0
  const noBypassMember = maxActiveTier < bypassTier

  function performSave(parsed: GeneralParsed) {
    startTransition(async () => {
      const res = await updateSettings({
        entityName: parsed.entityName,
        defaultCurrency: parsed.defaultCurrency,
        fiscalYearStartMonth: parsed.fiscalYearStartMonth,
        approvalBypassTier: parsed.approvalBypassTier,
        followUpDueDays: parsed.followUpDueDays,
        autoCreateProjectOnAccept: parsed.autoCreateProjectOnAccept,
        autoCompleteProjectOnPaid: parsed.autoCompleteProjectOnPaid,
        intercoAutoMirror: parsed.intercoAutoMirror,
        documentationModule: parsed.documentationModule,
        staleDealDays:
          parsed.staleDealDays === "" ? null : Number(parsed.staleDealDays),
        leadFollowUpDays:
          parsed.leadFollowUpDays === ""
            ? null
            : Number(parsed.leadFollowUpDays),
        defaultCountry: parsed.defaultCountry,
        phonePrefix: parsed.phonePrefix,
        entityCode: parsed.entityCode,
        taxInclusive: parsed.taxInclusive,
        autoWinOnQuoteAccept: parsed.autoWinOnQuoteAccept,
        allowPasswordLogin: parsed.allowPasswordLogin,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      const updated = res.data
      form.reset({
        entityName: updated.entityName,
        defaultCurrency: updated.defaultCurrency,
        fiscalYearStartMonth: updated.fiscalYearStartMonth,
        approvalBypassTier: updated.approvalBypassTier,
        followUpDueDays: updated.followUpDueDays,
        autoCreateProjectOnAccept: updated.autoCreateProjectOnAccept,
        autoCompleteProjectOnPaid: updated.autoCompleteProjectOnPaid,
        intercoAutoMirror: updated.intercoAutoMirror,
        documentationModule: updated.documentationModule,
        staleDealDays:
          updated.staleDealDays == null ? "" : String(updated.staleDealDays),
        leadFollowUpDays:
          updated.leadFollowUpDays == null
            ? ""
            : String(updated.leadFollowUpDays),
        defaultCountry: updated.defaultCountry,
        phonePrefix: updated.phonePrefix,
        entityCode: updated.entityCode,
        taxInclusive: updated.taxInclusive,
        autoWinOnQuoteAccept: updated.autoWinOnQuoteAccept,
        allowPasswordLogin: updated.allowPasswordLogin,
      })
      toast.success("Settings saved")
    })
  }

  function onSubmit(values: GeneralValues) {
    const parsed = generalSchema.parse(values)
    // Disabling password sign-in can lock out the whole org — confirm first.
    if (settings.allowPasswordLogin && !parsed.allowPasswordLogin) {
      setPendingValues(parsed)
      setConfirmLockout(true)
      return
    }
    performSave(parsed)
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
              name="entityName"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel required>Entity name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Quandatics Sdn Bhd" />
                  </FormControl>
                  <FormDescription>
                    The workspace name shown in the sidebar and on documents.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid content-start gap-2 sm:col-span-2">
              <span className="text-sm font-medium">Entity ID (tenant id)</span>
              <div className="flex items-center gap-2">
                <code className="flex h-9 min-w-0 flex-1 items-center overflow-x-auto rounded-md border bg-muted/40 px-3 font-mono text-sm">
                  {settings.organizationId}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(settings.organizationId)
                    toast.success("Entity ID copied")
                  }}
                >
                  <Copy className="size-3.5" />
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Read-only — identifies this entity in backend operations, e.g.{" "}
                <code className="font-mono">
                  npm run module:finance -- {settings.organizationId} on
                </code>
              </p>
            </div>
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
              name="defaultCountry"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default country</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Malaysia"
                      list="default-country-options"
                    />
                  </FormControl>
                  <datalist id="default-country-options">
                    {settings.countries.map((c) => (
                      <option key={c.name} value={c.name} />
                    ))}
                  </datalist>
                  <FormDescription>
                    Prefilled on new account addresses.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phonePrefix"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone prefix</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="+60 " maxLength={8} />
                  </FormControl>
                  <FormDescription>
                    Prefilled into empty phone fields (leads, contacts,
                    accounts).
                  </FormDescription>
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
                    Members whose tier (set per-member, defaulting from their
                    role&apos;s tier on the Team screen) is at or above this number
                    advance stages without approval. Highest active member tier:{" "}
                    <span className="tabular-nums font-medium">
                      {maxActiveTier < 0 ? "none" : maxActiveTier}
                    </span>
                    .
                  </FormDescription>
                  {noBypassMember ? (
                    <p className="text-sm text-destructive">
                      No active member meets this tier — every gated stage will
                      need approval and there is no one who can approve, so the
                      funnel can deadlock. Lower this tier or raise a
                      member&apos;s tier on the Team screen.
                    </p>
                  ) : null}
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
            {SWITCHES.filter(
              (s) => settings.financeEnabled || !FINANCE_SWITCHES.has(s.name)
            ).map((s, i) => (
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
            <Separator className="my-1" />
            <FormField
              control={form.control}
              name="staleDealDays"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-4 py-2">
                  <div className="grid gap-1">
                    <FormLabel>Stale funnel nudge (days)</FormLabel>
                    <FormDescription>
                      Show an open funnel on its owner&apos;s dashboard when it
                      has had no activity for this long. Empty = off.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      placeholder="off"
                      className="w-24"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Separator className="my-1" />
            <FormField
              control={form.control}
              name="leadFollowUpDays"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-4 py-2">
                  <div className="grid gap-1">
                    <FormLabel>Auto lead follow-up (days)</FormLabel>
                    <FormDescription>
                      Creating a lead also creates a &ldquo;First contact&rdquo;
                      follow-up due this many days later. Empty = off.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      placeholder="off"
                      className="w-24"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Separator className="my-1" />
            <FormField
              control={form.control}
              name="followUpDueDays"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-4 py-2">
                  <div className="grid gap-1">
                    <FormLabel>Follow-up window (days)</FormLabel>
                    <FormDescription>
                      How far ahead the dashboard looks for follow-ups
                      &ldquo;due soon&rdquo;.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={90}
                      className="w-24"
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

      <AlertDialog open={confirmLockout} onOpenChange={setConfirmLockout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable password sign-in?</AlertDialogTitle>
            <AlertDialogDescription>
              No one will be able to sign in with email + password. Unless another
              sign-in method (e.g. SSO) is configured for this organization, every
              member — including you — will be locked out and unable to reach
              Settings to turn it back on. Continue only if you have an
              alternative way in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingValues) performSave(pendingValues)
                setPendingValues(null)
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Disable sign-in
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Form>
  )
}

// ─── Numbering ───────────────────────────────────────────────────────────────

const numberingSchema = z.object({
  quotePrefix: z.string().trim().min(1, "Required"),
  quoteNextNumber: z.coerce.number().int().min(1, "≥ 1"),
  quotePadWidth: z.coerce.number().int().min(1, "1–10").max(10, "1–10"),
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
      quotePrefix: settings.quotePrefix,
      quoteNextNumber: settings.quoteNextNumber,
      quotePadWidth: settings.quotePadWidth,
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
  const quotePreview = `${values.quotePrefix ?? ""}${pad(
    Number(values.quoteNextNumber) || 0,
    Number(values.quotePadWidth) || 1
  )}`
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
        toast.error(res.error)
        return
      }
      const updated = res.data
      form.reset({
        quotePrefix: updated.quotePrefix,
        quoteNextNumber: updated.quoteNextNumber,
        quotePadWidth: updated.quotePadWidth,
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
              Project codes follow{" "}
              <span className="font-mono">
                {"{YYYY}-{Entity}-{Account}-{ProjectNature}-{NNN}"}
              </span>
              . The running number{" "}
              <span className="font-mono">NNN</span> is assigned per project and{" "}
              <span className="font-medium text-foreground">
                resets to 1 at the start of every year
              </span>{" "}
              — there is no single ever-incrementing project number to set here.
              The entity code comes from General settings, the account code from
              the account, and the project nature is chosen when the project is
              created. Only the zero-pad width of the running number is
              configured below.
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
                  <FormDescription>
                    Digits in the running number, e.g. width 3 → 001.
                  </FormDescription>
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

// ─── Industries — a plain PicklistCard instance (standard chip-list CRUD) ────

function IndustriesCard({ industries }: { industries: string[] }) {
  return (
    <PicklistCard
      title="Industries"
      description="Industry picklist offered on accounts."
      items={industries}
      defaults={[]}
      placeholder="e.g. Banking"
      save={updateIndustries}
    />
  )
}

// ─── Countries & states ────────────────────────────────────────────────────────

function CountriesCard({
  countries,
}: {
  countries: { name: string; states: string[] }[]
}) {
  const [items, setItems] = React.useState(countries)
  const [countryDraft, setCountryDraft] = React.useState("")
  const [stateDrafts, setStateDrafts] = React.useState<Record<string, string>>(
    {}
  )
  const [isPending, startTransition] = React.useTransition()

  const dirty = React.useMemo(
    () => JSON.stringify(items) !== JSON.stringify(countries),
    [items, countries]
  )

  function addCountry() {
    const name = countryDraft.trim()
    if (!name) return
    if (items.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast.error("That country is already in the list.")
      return
    }
    setItems((prev) => [...prev, { name, states: [] }])
    setCountryDraft("")
  }

  function removeCountry(name: string) {
    setItems((prev) => prev.filter((c) => c.name !== name))
  }

  function addState(country: string) {
    const st = (stateDrafts[country] ?? "").trim()
    if (!st) return
    setItems((prev) =>
      prev.map((c) => {
        if (c.name !== country) return c
        if (c.states.some((s) => s.toLowerCase() === st.toLowerCase())) return c
        return { ...c, states: [...c.states, st] }
      })
    )
    setStateDrafts((d) => ({ ...d, [country]: "" }))
  }

  function removeState(country: string, st: string) {
    setItems((prev) =>
      prev.map((c) =>
        c.name === country
          ? { ...c, states: c.states.filter((s) => s !== st) }
          : c
      )
    )
  }

  function save() {
    startTransition(async () => {
      const res = await updateCountries(items)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setItems(res.data)
      toast.success("Countries saved")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Countries & states</CardTitle>
        <CardDescription>
          The country picklist for account addresses. Each country carries its
          own states/provinces, offered once that country is selected on an
          account.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex gap-2">
          <Input
            value={countryDraft}
            onChange={(e) => setCountryDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addCountry()
              }
            }}
            placeholder="e.g. Malaysia"
          />
          <Button type="button" variant="outline" onClick={addCountry}>
            <Plus className="size-4" />
            Add country
          </Button>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-3">
            {items.map((c) => (
              <div key={c.name} className="grid gap-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{c.name}</span>
                  <button
                    type="button"
                    onClick={() => removeCountry(c.name)}
                    className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted-foreground/20"
                    aria-label={`Remove ${c.name}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                {c.states.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {c.states.map((s) => (
                      <Badge key={s} variant="secondary" className="gap-1 pr-1">
                        {s}
                        <button
                          type="button"
                          onClick={() => removeState(c.name, s)}
                          className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                          aria-label={`Remove ${s}`}
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No states yet (optional).
                  </p>
                )}
                <div className="flex gap-2">
                  <Input
                    value={stateDrafts[c.name] ?? ""}
                    onChange={(e) =>
                      setStateDrafts((d) => ({
                        ...d,
                        [c.name]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        addState(c.name)
                      }
                    }}
                    placeholder="Add a state / province"
                    className="h-8"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addState(c.name)}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No countries yet.</p>
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : "Save countries"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Project natures ───────────────────────────────────────────────────────────

function ProjectNaturesCard({ projectNatures }: { projectNatures: ProjectNature[] }) {
  const [items, setItems] = React.useState<ProjectNature[]>(projectNatures)
  const [codeDraft, setCodeDraft] = React.useState("")
  const [nameDraft, setNameDraft] = React.useState("")
  const [isPending, startTransition] = React.useTransition()

  const dirty = React.useMemo(() => {
    if (items.length !== projectNatures.length) return true
    return items.some(
      (v, i) =>
        v.code !== projectNatures[i].code || v.name !== projectNatures[i].name
    )
  }, [items, projectNatures])

  function add() {
    const code = normalizeProjectNatureCode(codeDraft)
    const name = nameDraft.trim()
    const codeError = validateProjectNatureCode(code)
    if (codeError) {
      toast.error(codeError)
      return
    }
    if (!name) {
      toast.error("Enter a display name.")
      return
    }
    if (items.some((v) => v.code === code)) {
      toast.error(`Code "${code}" is already in the list.`)
      return
    }
    setItems((prev) => [...prev, { code, name }])
    setCodeDraft("")
    setNameDraft("")
  }

  function remove(code: string) {
    setItems((prev) => prev.filter((v) => v.code !== code))
  }

  function save() {
    startTransition(async () => {
      const res = await updateProjectNatures(items)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setItems(res.data)
      toast.success("Project natures saved")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project natures</CardTitle>
        <CardDescription>
          The picklist offered when creating a project. Each type has a short,
          stable code used as the project-nature segment of a project code (e.g.{" "}
          <span className="font-mono">WEB</span> in{" "}
          <span className="font-mono">2026-DEMO-ACME-WEB-001</span>).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={codeDraft}
            onChange={(e) => setCodeDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            placeholder="Code, e.g. WEB"
            maxLength={PROJECT_NATURE_CODE_MAX}
            className="uppercase sm:max-w-[10rem]"
          />
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            placeholder="Display name, e.g. Web"
          />
          <Button type="button" variant="outline" onClick={add}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>

        {items.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {items.map((pt) => (
              <Badge key={pt.code} variant="secondary" className="gap-1 pr-1">
                <span className="font-mono">{pt.code}</span>
                <span className="text-muted-foreground">·</span>
                {pt.name}
                <button
                  type="button"
                  onClick={() => remove(pt.code)}
                  className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                  aria-label={`Remove ${pt.code}`}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No project natures yet.</p>
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : "Save project natures"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Product codes ───────────────────────────────────────────────────────────

function ProductCodesCard({ productCodes }: { productCodes: ProductCode[] }) {
  const [items, setItems] = React.useState<ProductCode[]>(productCodes)
  const [codeDraft, setCodeDraft] = React.useState("")
  const [nameDraft, setNameDraft] = React.useState("")
  const [isPending, startTransition] = React.useTransition()

  const dirty = React.useMemo(() => {
    if (items.length !== productCodes.length) return true
    return items.some(
      (v, i) => v.code !== productCodes[i].code || v.name !== productCodes[i].name
    )
  }, [items, productCodes])

  function add() {
    const code = normalizeProductCode(codeDraft)
    const name = nameDraft.trim()
    const codeError = validateProductCode(code)
    if (codeError) {
      toast.error(codeError)
      return
    }
    if (!name) {
      toast.error("Enter a display name.")
      return
    }
    if (items.some((v) => v.code === code)) {
      toast.error(`Code "${code}" is already in the list.`)
      return
    }
    setItems((prev) => [...prev, { code, name }])
    setCodeDraft("")
    setNameDraft("")
  }

  function remove(code: string) {
    setItems((prev) => prev.filter((v) => v.code !== code))
  }

  function save() {
    startTransition(async () => {
      const res = await updateProductCodes(items)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setItems(res.data)
      toast.success("Product codes saved")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product codes</CardTitle>
        <CardDescription>
          The product lines available in the catalog. Each standardised product
          is classified under one of these codes (e.g.{" "}
          <span className="font-mono">COACHING</span> · Coaching).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={codeDraft}
            onChange={(e) => setCodeDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            placeholder="Code, e.g. COACHING"
            maxLength={PRODUCT_CODE_MAX}
            className="uppercase sm:max-w-[12rem]"
          />
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            placeholder="Display name, e.g. Coaching"
          />
          <Button type="button" variant="outline" onClick={add}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>

        {items.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {items.map((pc) => (
              <Badge key={pc.code} variant="secondary" className="gap-1 pr-1">
                <span className="font-mono">{pc.code}</span>
                <span className="text-muted-foreground">·</span>
                {pc.name}
                <button
                  type="button"
                  onClick={() => remove(pc.code)}
                  className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                  aria-label={`Remove ${pc.code}`}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No product codes yet.</p>
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : "Save product codes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

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
        toast.error(res.error)
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
          <p className="text-sm text-muted-foreground">No custom fields yet.</p>
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
      toast.error(res.error)
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
      toast.error(res.error)
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
              Stages that still have funnels in them can&apos;t be deleted —
              move those funnels to another stage first.
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
        toast.error(res.error)
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
        <CardTitle>Members</CardTitle>
        <CardDescription>
          Read-only snapshot.{" "}
          <Link
            href="/team"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Manage members &amp; roles →
          </Link>
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

function AutoJoinCard({
  domains,
  role,
}: {
  domains: string[]
  role: string | null
}) {
  const [items, setItems] = React.useState<string[]>(domains)
  const [roleName, setRoleName] = React.useState<string>(role ?? "Rep")
  const [draft, setDraft] = React.useState("")
  const [isPending, startTransition] = React.useTransition()

  const dirty =
    items.join("|") !== domains.join("|") || roleName !== (role ?? "Rep")

  function add() {
    const d = draft.trim().toLowerCase().replace(/^@/, "")
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) {
      toast.error("Enter a valid domain, e.g. acme.com")
      return
    }
    if (items.includes(d)) {
      toast.error(`"${d}" is already listed.`)
      return
    }
    setItems((p) => [...p, d])
    setDraft("")
  }

  function save() {
    startTransition(async () => {
      const res = await updateAutoJoin({ domains: items, role: roleName })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setItems(res.data.domains)
      setRoleName(res.data.role ?? "Rep")
      toast.success("Auto-join saved")
    })
  }

  const roleItems = AUTO_JOIN_ROLES.map((r) => ({ value: r, label: r }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auto-join by email domain</CardTitle>
        <CardDescription>
          Anyone who signs in with Microsoft using one of these email domains
          joins this workspace automatically with the role below. Leave empty to
          require invites. An admin can change anyone&apos;s role afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5 sm:max-w-xs">
          <label className="text-xs text-muted-foreground">Default role</label>
          <Select
            value={roleName}
            onValueChange={(v) => setRoleName(v || "Rep")}
            items={roleItems}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleItems.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <label className="text-xs text-muted-foreground">
            Allowed email domains
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  add()
                }
              }}
              placeholder="e.g. acme.com"
            />
            <Button type="button" variant="outline" onClick={add}>
              <Plus className="size-4" />
              Add domain
            </Button>
          </div>
        </div>

        {items.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {items.map((d) => (
              <Badge key={d} variant="secondary" className="gap-1 pr-1">
                {d}
                <button
                  type="button"
                  onClick={() => setItems((p) => p.filter((x) => x !== d))}
                  className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                  aria-label={`Remove ${d}`}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No domains — sign-in is invite-only.
          </p>
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : "Save auto-join"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Payment-milestone template: title + percent rows auto-seeded onto any new
 * project that starts with a value. Percents must sum to ≤ 100; the last
 * milestone absorbs cent rounding when the template allocates the full 100%.
 */
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
        toast.error(res.error)
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

/**
 * Company profile: identity + payment details printed on customer-facing
 * documents (the quotation), plus the logo upload (served at
 * /api/tenant-logo).
 */
function CompanyProfileCard({
  profile,
  hasLogo,
}: {
  profile: CompanyProfile
  hasLogo: boolean
}) {
  const router = useRouter()
  const [values, setValues] = React.useState<CompanyProfile>(profile)
  const [isPending, startTransition] = React.useTransition()
  const [logoBusy, setLogoBusy] = React.useState(false)
  // Bust the browser cache after an upload so the preview refreshes.
  const [logoVersion, setLogoVersion] = React.useState(0)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const dirty = JSON.stringify(values) !== JSON.stringify(profile)
  const set =
    (key: keyof CompanyProfile) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) =>
      setValues((p) => ({ ...p, [key]: e.target.value }))

  function save() {
    startTransition(async () => {
      const res = await updateCompanyProfile(values)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setValues(res.data.companyProfile)
      toast.success("Company profile saved")
    })
  }

  async function onLogoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoBusy(true)
    try {
      const fd = new FormData()
      fd.set("file", file)
      const res = await uploadCompanyLogo(fd)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Logo updated")
      setLogoVersion((v) => v + 1)
      router.refresh()
    } finally {
      setLogoBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  async function onLogoRemove() {
    setLogoBusy(true)
    try {
      const res = await removeCompanyLogo()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Logo removed")
      router.refresh()
    } finally {
      setLogoBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company profile</CardTitle>
        <CardDescription>
          Printed on customer-facing documents (the quotation): identity block
          at the top, bank details and footer at the bottom.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex flex-wrap items-center gap-4">
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/tenant-logo?v=${logoVersion}`}
              alt="Company logo"
              className="h-12 max-w-40 rounded border bg-white object-contain p-1"
            />
          ) : (
            <span className="text-sm text-muted-foreground">No logo yet.</span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={onLogoPicked}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={logoBusy}
              onClick={() => fileRef.current?.click()}
            >
              {logoBusy ? "Working…" : hasLogo ? "Replace logo" : "Upload logo"}
            </Button>
            {hasLogo ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={logoBusy}
                onClick={onLogoRemove}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <label className="text-xs text-muted-foreground">Address</label>
            <Textarea
              rows={3}
              value={values.address}
              onChange={set("address")}
              placeholder={"Level 10, Menara …\n50450 Kuala Lumpur, Malaysia"}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs text-muted-foreground">
              Registration no.
            </label>
            <Input
              value={values.registrationNo}
              onChange={set("registrationNo")}
              placeholder="202001012345 (1234567-X)"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs text-muted-foreground">Phone</label>
            <Input
              value={values.phone}
              onChange={set("phone")}
              placeholder="+60 3-1234 5678"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs text-muted-foreground">Email</label>
            <Input
              value={values.email}
              onChange={set("email")}
              placeholder="hello@company.com"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs text-muted-foreground">Website</label>
            <Input
              value={values.website}
              onChange={set("website")}
              placeholder="www.company.com"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <label className="text-xs text-muted-foreground">
              Bank / payment details
            </label>
            <Textarea
              rows={3}
              value={values.bankDetails}
              onChange={set("bankDetails")}
              placeholder={"Bank: …\nAccount name: …\nAccount no: …"}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <label className="text-xs text-muted-foreground">
              Quote footer / terms
            </label>
            <Textarea
              rows={3}
              value={values.quoteFooter}
              onChange={set("quoteFooter")}
              placeholder="Payment due within 30 days of invoice…"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Generic chip-list editor for a simple tenant picklist (currencies, payment
 * terms). Empty list = the built-in defaults, shown greyed as a hint.
 */
function PicklistCard({
  title,
  description,
  items: saved,
  defaults,
  placeholder,
  normalize = (s) => s,
  validate,
  save: saveAction,
}: {
  title: string
  description: string
  items: string[]
  defaults: string[]
  placeholder: string
  normalize?: (s: string) => string
  validate?: (s: string) => string | null
  save: (items: string[]) => Promise<{ ok: boolean; error?: string }>
}) {
  const [items, setItems] = React.useState<string[]>(saved)
  // Local baseline so the Save button re-disables after a successful save
  // without waiting for a page refresh to update the `saved` prop.
  const [baseline, setBaseline] = React.useState<string[]>(saved)
  const [draft, setDraft] = React.useState("")
  const [isPending, startTransition] = React.useTransition()
  const dirty = items.join("|") !== baseline.join("|")
  const usingDefaults = items.length === 0

  function add() {
    const v = normalize(draft.trim())
    if (!v) return
    const err = validate?.(v)
    if (err) {
      toast.error(err)
      return
    }
    if (items.includes(v)) {
      toast.error(`"${v}" is already listed.`)
      return
    }
    setItems((p) => [...p, v])
    setDraft("")
  }

  function save() {
    startTransition(async () => {
      const res = await saveAction(items)
      if (!res.ok) {
        toast.error(res.error ?? "Save failed")
        return
      }
      setBaseline(items)
      toast.success(`${title} saved`)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            placeholder={placeholder}
          />
          <Button type="button" variant="outline" onClick={add}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(usingDefaults ? defaults : items).map((v) => (
            <Badge
              key={v}
              variant={usingDefaults ? "outline" : "secondary"}
              className="gap-1 pr-1"
            >
              {v}
              {!usingDefaults ? (
                <button
                  type="button"
                  onClick={() => setItems((p) => p.filter((x) => x !== v))}
                  className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                  aria-label={`Remove ${v}`}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
        {usingDefaults ? (
          <p className="text-xs text-muted-foreground">
            {defaults.length > 0
              ? "Using the built-in defaults — add an entry to take over the list."
              : "Nothing configured yet — add the first entry above."}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : `Save ${title.toLowerCase()}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Intercompany partner allow-list. Options are the OTHER entities the current
 * user belongs to (the only candidates `resolveHandlingPartner` accepts);
 * an empty list keeps the legacy "any own entity" behavior.
 */
function IntercompanyPartnersCard({
  allowedIds,
  entities,
}: {
  allowedIds: string[]
  entities: { id: string; name: string }[]
}) {
  const [selected, setSelected] = React.useState<Set<string>>(
    new Set(allowedIds)
  )
  const [isPending, startTransition] = React.useTransition()

  const dirty =
    [...selected].sort().join("|") !== [...allowedIds].sort().join("|")

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function save() {
    startTransition(async () => {
      const res = await updateIntercompanyPartners([...selected])
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setSelected(new Set(res.data.intercompanyPartnerIds))
      toast.success("Intercompany partners saved")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Intercompany partners</CardTitle>
        <CardDescription>
          Entities that may be picked as the handling partner on an
          intercompany funnel. Leave all unchecked to allow any entity you
          belong to (legacy behavior). Once any are checked, only those are
          valid partners.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {entities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You don&apos;t belong to any other entity — there are no candidate
            partners to allow-list.
          </p>
        ) : (
          <div className="grid gap-2">
            {entities.map((e) => (
              <label
                key={e.id}
                className="flex items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={selected.has(e.id)}
                  onCheckedChange={(v) => toggle(e.id, v === true)}
                />
                {e.name}
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : "Save partners"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function SettingsClient({
  settings,
  members,
  funnel,
  entities,
}: {
  settings: TenantSettingsView
  members: TenantMemberView[]
  funnel: DefaultFunnelView
  entities: { id: string; name: string }[]
}) {
  return (
    <Tabs defaultValue="general" className="w-full">
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="numbering">Numbering</TabsTrigger>
        <TabsTrigger value="industries">Industries</TabsTrigger>
        <TabsTrigger value="project-natures">Project Natures</TabsTrigger>
        <TabsTrigger value="product-codes">Product Codes</TabsTrigger>
        <TabsTrigger value="stages">Funnel Stages</TabsTrigger>
        <TabsTrigger value="team">Members</TabsTrigger>
      </TabsList>

      <TabsContent value="general" className="mt-4">
        <div className="grid gap-6">
          <GeneralForm settings={settings} members={members} />

          <CompanyProfileCard
            profile={settings.companyProfile}
            hasLogo={settings.hasLogo}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <PicklistCard
              title="Currencies"
              description="ISO-4217 codes offered in the funnel/quote currency pickers. The first entry is the default."
              items={settings.currencies}
              defaults={DEFAULT_CURRENCIES}
              placeholder="e.g. MYR"
              normalize={(s) => s.toUpperCase()}
              validate={(s) =>
                /^[A-Z]{3}$/.test(s) ? null : "Enter a 3-letter ISO code."
              }
              save={updateCurrencies}
            />
            <PicklistCard
              title="Payment terms"
              description="Terms offered when submitting a sales order."
              items={settings.paymentTerms}
              defaults={DEFAULT_PAYMENT_TERMS}
              placeholder="e.g. 30 days"
              save={updatePaymentTerms}
            />
            <PicklistCard
              title="Sales-order document kinds"
              description="What a submitted supporting document can be identified as."
              items={settings.soDocumentKinds}
              defaults={DEFAULT_SO_DOCUMENT_KINDS}
              placeholder="e.g. PO"
              save={updateSoDocumentKinds}
            />
          </div>

          <IntercompanyPartnersCard
            allowedIds={settings.intercompanyPartnerIds}
            entities={entities}
          />

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

      <TabsContent value="numbering" className="mt-4 grid gap-6">
        <NumberingForm settings={settings} />
        <MilestoneTemplateCard template={settings.milestoneTemplate} />
        {settings.financeEnabled ? (
          <PicklistCard
            title="Invoice reminders"
            description="Days AFTER the due date at which reminder 1, 2, 3… become due on the dashboard and billing pages. Empty = the built-in 7 / 14 / 30."
            items={settings.invoiceReminderDays.map(String)}
            defaults={["7", "14", "30"]}
            placeholder="e.g. 7"
            validate={(v) =>
              Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 365
                ? null
                : "Enter days as a whole number (1–365)."
            }
            save={updateInvoiceReminderDays}
          />
        ) : null}
      </TabsContent>

      <TabsContent value="industries" className="mt-4 grid gap-4">
        <IndustriesCard industries={settings.industries} />
        <CountriesCard countries={settings.countries} />
        <div className="grid gap-4 lg:grid-cols-2">
          <PicklistCard
            title="Lead sources"
            description="Where a lead came from — offered in the lead form so sources stay consistent for reporting."
            items={settings.leadSources}
            defaults={DEFAULT_LEAD_SOURCES}
            placeholder="e.g. Webinar"
            save={updateLeadSources}
          />
          <PicklistCard
            title="Loss / disqualify reasons"
            description="Offered when disqualifying a lead (and available for lost-deal analysis)."
            items={settings.lossReasons}
            defaults={DEFAULT_LOSS_REASONS}
            placeholder="e.g. No budget"
            save={updateLossReasons}
          />
        </div>
      </TabsContent>

      <TabsContent value="project-natures" className="mt-4">
        <ProjectNaturesCard projectNatures={settings.projectNatures} />
      </TabsContent>

      <TabsContent value="product-codes" className="mt-4">
        <ProductCodesCard productCodes={settings.productCodes} />
      </TabsContent>

      <TabsContent value="stages" className="mt-4 grid gap-4">
        <FunnelStagesCard funnel={funnel} customFields={settings.customFunnelFields} />
        <CustomFunnelFieldsCard fields={settings.customFunnelFields} />
      </TabsContent>

      <TabsContent value="team" className="mt-4 grid gap-4">
        <AutoJoinCard
          domains={settings.autoJoinDomains}
          role={settings.autoJoinRole}
        />
        <TeamTable members={members} />
      </TabsContent>
    </Tabs>
  )
}
