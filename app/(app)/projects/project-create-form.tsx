"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
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
import { Combobox } from "@/components/ui/combobox"
import { AccountQuickCreate } from "@/components/quick-create-account"
import { createProject, prefillFromOpportunity } from "./actions"

const STATUS_OPTIONS = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
]

const NONE = "__none__"

const CODE_NATURE_OPTIONS = [
  { value: "auto", label: "Auto-generate" },
  { value: "manual", label: "Manual" },
]

// The 5-segment project-code shape: {YYYY}-{ENTITY}-{ACCOUNT}-{TYPE}-{NNN}.
// Segments are alphanumeric (no inner hyphens); first is a 4-digit year, last
// is the running number. Used to validate a manually entered code.
const PROJECT_CODE_RE = /^\d{4}-[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9]+-\d+$/

const projectSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    accountId: z.string().min(1, "Account is required"),
    productTypeCode: z.string().min(1, "Product type is required"),
    opportunityId: z.string().optional(),
    value: z.string().trim().optional(),
    startDate: z.string().trim().optional(),
    status: z.enum(["planning", "active", "on_hold", "completed", "cancelled"]),
    codeNature: z.enum(["auto", "manual"]),
    projectCode: z.string().trim().optional(),
  })
  .refine(
    (v) => v.codeNature !== "manual" || (v.projectCode?.trim().length ?? 0) > 0,
    { message: "Project code is required", path: ["projectCode"] }
  )
  .refine(
    (v) =>
      v.codeNature !== "manual" ||
      !v.projectCode?.trim() ||
      PROJECT_CODE_RE.test(v.projectCode.trim()),
    {
      message: "Use the format YYYY-ENTITY-ACCOUNT-TYPE-NNN (e.g. 2026-DEMO-ACME-WEB-001)",
      path: ["projectCode"],
    }
  )

type ProjectFormValues = z.infer<typeof projectSchema>

type AccountOption = { id: string; name: string }
type OpportunityOption = { id: string; name: string; accountId: string }
type ProductTypeOption = { code: string; name: string }

export function ProjectCreateForm({
  accounts,
  opportunities,
  productTypes,
  entityCode,
  codeYear,
  accountCodes,
  defaultName,
  defaultAccountId,
  defaultOpportunityId,
  defaultValue,
  defaultCurrency,
  defaultQuotationId,
  prefillQuoteNumber,
}: {
  accounts: AccountOption[]
  opportunities: OpportunityOption[]
  productTypes: ProductTypeOption[]
  /** ENTITY segment of the generated code (tenant entity code). */
  entityCode: string
  /** YYYY segment of the generated code (current local year). */
  codeYear: number
  /** Account short codes keyed by id, for the ACCOUNTCODE preview segment. */
  accountCodes: Record<string, string>
  defaultName?: string
  defaultAccountId?: string
  defaultOpportunityId?: string
  defaultValue?: string
  defaultCurrency?: string
  defaultQuotationId?: string
  prefillQuoteNumber?: string
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)

  // Account options become local state so inline "+ Create" can append the new
  // account and have it immediately selectable.
  const [accountOptions, setAccountOptions] = React.useState(accounts)
  const [accountCreate, setAccountCreate] = React.useState<{
    open: boolean
    name: string
  }>({ open: false, name: "" })

  // The project links the source quotation when created from a funnel. This is
  // not a visible form field — it travels alongside the (editable) value.
  const [quotationId, setQuotationId] = React.useState<string | undefined>(
    defaultQuotationId
  )
  // Source deal currency, carried through so the project isn't defaulted to MYR.
  // Like quotationId, it travels alongside the value rather than as a field.
  const [currency, setCurrency] = React.useState<string | undefined>(
    defaultCurrency
  )
  // Quote number backing the "pre-filled from quotation …" note. Cleared when
  // the funnel is changed/removed and the new funnel has no source quote.
  const [quoteNote, setQuoteNote] = React.useState<string | undefined>(
    prefillQuoteNumber
  )

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: defaultName ?? "",
      accountId: defaultAccountId ?? "",
      productTypeCode: "",
      opportunityId: defaultOpportunityId ?? NONE,
      value: defaultValue ?? "",
      startDate: "",
      status: "planning",
      codeNature: "auto",
      projectCode: "",
    },
  })

  const codeNature = form.watch("codeNature")
  const watchedAccountId = form.watch("accountId")
  const watchedProductType = form.watch("productTypeCode")

  // Live preview of the code the server will mint, mirroring nextProjectCode's
  // {YYYY}-{ENTITY}-{ACCOUNTCODE}-{PRODUCTTYPE}-{NNN} shape. NNN is unknown until
  // creation, so it's shown as "###". Segments fall back the same way the server
  // does when a value isn't picked yet.
  const previewCode = React.useMemo(() => {
    const yyyy = String(codeYear)
    const entity = (entityCode || "ENT").toUpperCase()
    const acct = (accountCodes[watchedAccountId] || "ACC").toUpperCase()
    const product = (watchedProductType || "TYPE").toUpperCase()
    return `${yyyy}-${entity}-${acct}-${product}-###`
  }, [codeYear, entityCode, accountCodes, watchedAccountId, watchedProductType])

  const selectedAccountHasCode = Boolean(accountCodes[watchedAccountId])

  async function handleSubmit(values: ProjectFormValues) {
    setSubmitting(true)
    const opportunityId =
      values.opportunityId && values.opportunityId !== NONE
        ? values.opportunityId
        : undefined
    const res = await createProject({
      name: values.name,
      accountId: values.accountId,
      productTypeCode: values.productTypeCode,
      opportunityId,
      quotationId: opportunityId ? quotationId : undefined,
      value: values.value || undefined,
      currency: opportunityId ? currency : undefined,
      startDate: values.startDate || undefined,
      status: values.status,
      codeNature: values.codeNature,
      projectCode:
        values.codeNature === "manual" ? values.projectCode : undefined,
    })
    if (!res.ok) {
      toast.error(res.error)
      setSubmitting(false)
      return
    }
    toast.success(`Project ${res.data.projectCode} created`)
    router.push(`/projects/${res.data.id}`)
  }

  return (
    <>
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Implementation rollout" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="productTypeCode"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel required>Product type</FormLabel>
                  <FormControl>
                    <Combobox
                      value={field.value}
                      onChange={field.onChange}
                      options={productTypes.map((p) => ({
                        value: p.code,
                        label: `${p.name} (${p.code})`,
                      }))}
                      placeholder="Select a product type…"
                      searchPlaceholder="Search product types…"
                      emptyMessage={
                        productTypes.length
                          ? "No product types found."
                          : "No product types yet — add them in Settings."
                      }
                      aria-invalid={!!fieldState.error}
                    />
                  </FormControl>
                  <p className="text-muted-foreground text-xs">
                    Sets the product-type segment of the project code.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="codeNature"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code assignment</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v)
                        // Drop any stale manual code + its error when switching
                        // back to auto-generation.
                        if (v !== "manual") {
                          form.setValue("projectCode", "")
                          form.clearErrors("projectCode")
                        }
                      }}
                      items={CODE_NATURE_OPTIONS}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="How to assign the code" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CODE_NATURE_OPTIONS.map((o) => (
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

              {codeNature === "manual" ? (
                <FormField
                  control={form.control}
                  name="projectCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Code</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. 2026-DEMO-ACME-WEB-001"
                          className="font-mono"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
            </div>

            {codeNature === "manual" ? null : (
              <div className="grid gap-1 rounded-lg border border-dashed bg-muted/30 p-3">
                <span className="text-muted-foreground text-xs">
                  Generated code (preview)
                </span>
                <span className="font-mono text-sm font-semibold">
                  {previewCode}
                </span>
                <span className="text-muted-foreground text-xs">
                  ### becomes the next running number for {codeYear} on creation.
                  {!selectedAccountHasCode
                    ? " Set the account's code so ACCOUNT resolves."
                    : null}
                </span>
              </div>
            )}

            <FormField
              control={form.control}
              name="accountId"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel required>Account</FormLabel>
                  <FormControl>
                    <Combobox
                      value={field.value}
                      onChange={field.onChange}
                      options={accountOptions.map((a) => ({
                        value: a.id,
                        label: a.name,
                      }))}
                      placeholder="Select an account…"
                      searchPlaceholder="Search accounts…"
                      emptyMessage="No accounts found."
                      aria-invalid={!!fieldState.error}
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
              name="opportunityId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Funnel (optional)</FormLabel>
                  <FormControl>
                    <Combobox
                      value={field.value}
                      onChange={(v) => {
                        field.onChange(v)
                        if (!v || v === NONE) {
                          // Detach: clear the linked quote + note + currency.
                          // Value stays as-is.
                          setQuotationId(undefined)
                          setQuoteNote(undefined)
                          setCurrency(undefined)
                          return
                        }
                        // Derive the account from the chosen funnel, then
                        // re-prefill value + linked quote + currency from its net.
                        const opp = opportunities.find((o) => o.id === v)
                        if (opp) form.setValue("accountId", opp.accountId)
                        void prefillFromOpportunity(v).then((p) => {
                          if (!p) return
                          form.setValue("value", p.value)
                          // Only fill the name when the user hasn't typed one,
                          // so changing the funnel never clobbers an edit.
                          if (!form.getValues("name").trim()) {
                            form.setValue("name", p.opportunityName)
                          }
                          setQuotationId(p.quotationId ?? undefined)
                          setQuoteNote(p.quoteNumber ?? undefined)
                          setCurrency(p.currency)
                        })
                      }}
                      options={[
                        { value: NONE, label: "None" },
                        ...opportunities.map((o) => ({
                          value: o.id,
                          label: o.name,
                        })),
                      ]}
                      placeholder="Link a funnel…"
                      searchPlaceholder="Search funnels…"
                      emptyMessage="No funnels found."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Value</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        {...field}
                      />
                    </FormControl>
                    {quoteNote ? (
                      <p className="text-muted-foreground text-xs">
                        Pre-filled from quotation {quoteNote} (net) — editable.
                      </p>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    items={STATUS_OPTIONS}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Pick a status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {STATUS_OPTIONS.map((o) => (
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
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/projects")}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create project"}
          </Button>
        </div>
      </form>
    </Form>

      <AccountQuickCreate
        open={accountCreate.open}
        onOpenChange={(o) => setAccountCreate((s) => ({ ...s, open: o }))}
        defaultName={accountCreate.name}
        onCreated={(rec) => {
          setAccountOptions((prev) => [...prev, rec])
          form.setValue("accountId", rec.id)
        }}
      />
    </>
  )
}
