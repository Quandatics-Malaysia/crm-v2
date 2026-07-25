"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { showActionError } from "@/lib/show-action-error"
import { Copy } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileDropzone } from "@/components/file-dropzone"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
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
import { PicklistCard } from "@/components/picklist-card"
import {
  updateSettings,
  updateIntercompanyPartners,
  updateCurrencies,
  updateCompanyProfile,
  uploadCompanyLogo,
  removeCompanyLogo,
  type CompanyProfile,
  type TenantSettingsView,
  type TenantMemberView,
} from "@/app/(app)/settings/actions"
import { DEFAULT_CURRENCIES } from "@/lib/tenant-defaults"
import { Textarea } from "@/components/ui/textarea"

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
        showActionError(res)
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
                Read-only — identifies this entity in backend operations.
                Optional modules are enabled deployment-wide in{" "}
                <code className="font-mono">modules.config.ts</code> (then rebuild
                / redeploy), not per entity.
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

// ─── Company profile ────────────────────────────────────────────────────────

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
        showActionError(res)
        return
      }
      setValues(res.data.companyProfile)
      toast.success("Company profile saved")
    })
  }

  async function onLogoPicked(files: File[]) {
    const file = files[0]
    if (!file) return
    setLogoBusy(true)
    try {
      const fd = new FormData()
      fd.set("file", file)
      const res = await uploadCompanyLogo(fd)
      if (!res.ok) {
        showActionError(res)
        return
      }
      toast.success("Logo updated")
      setLogoVersion((v) => v + 1)
      router.refresh()
    } finally {
      setLogoBusy(false)
    }
  }

  async function onLogoRemove() {
    setLogoBusy(true)
    try {
      const res = await removeCompanyLogo()
      if (!res.ok) {
        showActionError(res)
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
        <div className="grid gap-3">
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
          <FileDropzone
            files={[]}
            onFiles={onLogoPicked}
            multiple={false}
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            hint="PNG, JPEG, WebP or SVG"
            compact
            busy={logoBusy}
          />
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
        showActionError(res)
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

export function GeneralClient({
  settings,
  members,
  entities,
}: {
  settings: TenantSettingsView
  members: TenantMemberView[]
  entities: { id: string; name: string }[]
}) {
  return (
    <div className="grid gap-6">
      <GeneralForm settings={settings} members={members} />

      <CompanyProfileCard
        profile={settings.companyProfile}
        hasLogo={settings.hasLogo}
      />

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

      <IntercompanyPartnersCard
        allowedIds={settings.intercompanyPartnerIds}
        entities={entities}
      />
    </div>
  )
}
