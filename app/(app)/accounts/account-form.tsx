"use client"

import * as React from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { showActionError } from "@/lib/show-action-error"
import { useDialogOpen } from "@/components/use-dialog-open"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Combobox } from "@/components/ui/combobox"
import { AccountQuickCreate } from "@/components/quick-create-account"
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
import type { Option, CountryOption } from "@/lib/lookups"
import {
  createAccount,
  updateAccount,
  findSimilarAccounts,
  type AccountRow,
  type BillingAddress,
  type SimilarAccount,
} from "./actions"

const NONE = "__none__"

const ACCOUNT_TYPE_ITEMS = [
  { value: "client", label: "Client (end user)" },
  { value: "reseller", label: "Reseller (channel)" },
]

const schema = z
  .object({
    name: z.string().min(1, "Name is required"),
    code: z
      .string()
      .refine(
        (v) => /^[A-Za-z0-9]{2,6}$/.test((v ?? "").trim()),
        "Company code is required (2–6 letters/digits)"
      ),
    registrationNumber: z.string().optional(),
    parentAccountId: z.string().optional(),
    accountType: z.enum(["client", "reseller"]),
    endUserAccountId: z.string().optional(),
    industry: z.string().optional(),
    website: z
      .union([z.string().url("Invalid URL"), z.literal("")])
      .optional(),
    phone: z.string().optional(),
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postcode: z.string().optional(),
    country: z.string().min(1, "Country is required"),
  })
  .superRefine((v, ctx) => {
    if (v.accountType === "reseller" && !v.endUserAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endUserAccountId"],
        message: "End user is required for resellers",
      })
    }
  })

type FormValues = z.infer<typeof schema>

function addr(account?: AccountRow): BillingAddress {
  return (account?.billingAddress as BillingAddress | null) ?? {}
}

/** Tenant presets (Settings → General) prefilled on CREATE only. */
export type AccountFormPresets = { defaultCountry?: string; phonePrefix?: string }

function defaults(account?: AccountRow, presets?: AccountFormPresets): FormValues {
  const a = addr(account)
  return {
    name: account?.name ?? "",
    code: account?.code ?? "",
    registrationNumber: account?.registrationNumber ?? "",
    parentAccountId: account?.parentAccountId ?? NONE,
    accountType: account?.accountType === "reseller" ? "reseller" : "client",
    endUserAccountId: account?.endUserAccountId ?? "",
    industry: account?.industry ?? "",
    website: account?.website ?? "",
    // Presets apply only to a NEW account — an existing blank stays blank.
    phone: account ? account.phone ?? "" : presets?.phonePrefix ?? "",
    line1: a.line1 ?? "",
    line2: a.line2 ?? "",
    city: a.city ?? "",
    state: a.state ?? "",
    postcode: a.postcode ?? "",
    country: account ? a.country ?? "" : presets?.defaultCountry ?? "",
  }
}

export function AccountForm({
  account,
  parentOptions,
  endUserOptions,
  industries,
  countries = [],
  presets,
  trigger,
  open: controlledOpen,
  onOpenChange,
  onSaved,
}: {
  /** Existing account to edit; omit to create. */
  account?: AccountRow
  /** Selectable parent accounts (already excludes self for edits). */
  parentOptions: Option[]
  /** Selectable end-user accounts for resellers (already excludes self for edits). */
  endUserOptions: Option[]
  /** Configurable industry picklist from listIndustries(). */
  industries: string[]
  /** Configurable country → states picklist from listCountries(). */
  countries?: CountryOption[]
  /** Tenant presets (getFormPresets) prefilled on create. */
  presets?: AccountFormPresets
  /** Render-prop trigger. Omit when controlling open externally. */
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSaved?: () => void
}) {
  const [open, setOpen] = useDialogOpen(controlledOpen, onOpenChange)
  const editing = !!account

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults(account, presets),
  })

  // Near-miss duplicate warning (create only): checked when the user leaves
  // the Name field. Warn-only — submitting is still allowed; the exact-match
  // duplicate is blocked server-side by createAccount.
  const [similar, setSimilar] = React.useState<SimilarAccount[]>([])
  const checkSimilar = React.useCallback(
    async (name: string) => {
      if (editing) return
      setSimilar(name.trim().length >= 3 ? await findSimilarAccounts(name) : [])
    },
    [editing]
  )

  React.useEffect(() => {
    if (open) form.reset(defaults(account, presets))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Parent / end-user options become local state so inline "+ Create" can
  // append the new account and have it immediately selectable.
  const [parentOptionsState, setParentOptionsState] =
    React.useState(parentOptions)
  const [endUserOptionsState, setEndUserOptionsState] =
    React.useState(endUserOptions)
  const [accountCreate, setAccountCreate] = React.useState<{
    open: boolean
    name: string
    target: "parent" | "endUser"
  }>({ open: false, name: "", target: "parent" })

  const parentItems = React.useMemo(
    () => [
      { value: NONE, label: "No parent" },
      ...parentOptionsState.map((o) => ({ value: o.id, label: o.name })),
    ],
    [parentOptionsState]
  )
  const endUserItems = React.useMemo(
    () => endUserOptionsState.map((o) => ({ value: o.id, label: o.name })),
    [endUserOptionsState]
  )
  const industryItems = React.useMemo(
    () => [
      { value: NONE, label: "None" },
      ...industries.map((i) => ({ value: i, label: i })),
    ],
    [industries]
  )

  const accountType = form.watch("accountType")
  const isReseller = accountType === "reseller"

  // Cascading address picklists: state options come from the chosen country.
  const countryVal = form.watch("country")
  const stateOptions = React.useMemo(
    () => countries.find((c) => c.name === countryVal)?.states ?? [],
    [countries, countryVal]
  )

  async function onSubmit(values: FormValues) {
    const billingAddress: BillingAddress = {
      line1: values.line1 || null,
      line2: values.line2 || null,
      city: values.city || null,
      state: values.state || null,
      postcode: values.postcode || null,
      country: values.country || null,
    }
    const payload = {
      name: values.name,
      code: values.code || null,
      registrationNumber: values.registrationNumber || null,
      parentAccountId:
        values.parentAccountId && values.parentAccountId !== NONE
          ? values.parentAccountId
          : null,
      accountType: values.accountType,
      endUserAccountId:
        values.accountType === "reseller"
          ? values.endUserAccountId || null
          : null,
      industry: values.industry || null,
      website: values.website || null,
      phone: values.phone || null,
      billingAddress,
    }
    const res = editing
      ? await updateAccount(account!.id, payload)
      : await createAccount(payload)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success(editing ? "Account updated" : "Account created")
    setOpen(false)
    onSaved?.()
  }

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger render={trigger as React.ReactElement} />
      ) : null}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit account" : "New account"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid max-h-[70vh] gap-4 overflow-y-auto px-1"
            id="account-form"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Acme Corp"
                        {...field}
                        onBlur={() => {
                          field.onBlur()
                          void checkSimilar(field.value)
                        }}
                      />
                    </FormControl>
                    {similar.length > 0 ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Similar account{similar.length > 1 ? "s" : ""} already
                        exist{similar.length > 1 ? "" : "s"}:{" "}
                        {similar.map((s, i) => (
                          <React.Fragment key={s.id}>
                            {i > 0 ? ", " : ""}
                            <Link
                              href={`/accounts/${s.id}`}
                              className="underline underline-offset-2"
                              target="_blank"
                            >
                              {s.name}
                            </Link>
                          </React.Fragment>
                        ))}{" "}
                        — double-check before creating a duplicate.
                      </p>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Company code</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="TTDC"
                        className="uppercase"
                        maxLength={6}
                        {...field}
                        onChange={(e) =>
                          field.onChange(e.target.value.toUpperCase())
                        }
                      />
                    </FormControl>
                    <FormDescription>

                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="registrationNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Registration number</FormLabel>
                    <FormControl>
                      <Input placeholder="201901234567 (SSM)" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website</FormLabel>
                    <FormControl>
                      <Input placeholder="https://acme.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Office phone</FormLabel>
                    <FormControl>
                      <Input placeholder="03-2782 2100" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="parentAccountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Parent account</FormLabel>
                  <FormControl>
                    <Combobox
                      value={field.value}
                      onChange={field.onChange}
                      options={parentItems}
                      placeholder="No parent"
                      searchPlaceholder="Search accounts…"
                      emptyMessage="No accounts found."
                      onCreate={(q) =>
                        setAccountCreate({
                          open: true,
                          name: q,
                          target: "parent",
                        })
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="accountType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v)
                        // A client is its own end user — clear the link.
                        if (v !== "reseller") {
                          form.setValue("endUserAccountId", "", {
                            shouldValidate: true,
                          })
                        }
                      }}
                      items={ACCOUNT_TYPE_ITEMS}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select type…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ACCOUNT_TYPE_ITEMS.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {isReseller ? (
                <FormField
                  control={form.control}
                  name="endUserAccountId"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel required>End user</FormLabel>
                      <FormControl>
                        <Combobox
                          value={field.value || ""}
                          onChange={field.onChange}
                          options={endUserItems}
                          placeholder="Select end user…"
                          searchPlaceholder="Search accounts…"
                          emptyMessage="No accounts found."
                          aria-invalid={!!fieldState.error}
                          onCreate={(q) =>
                            setAccountCreate({
                              open: true,
                              name: q,
                              target: "endUser",
                            })
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
              <FormField
                control={form.control}
                name="industry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Industry</FormLabel>
                    <Select
                      value={field.value || NONE}
                      onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
                      items={industryItems}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select industry…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        {industries.map((i) => (
                          <SelectItem key={i} value={i}>
                            {i}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 rounded-lg border p-4">
              <p className="text-sm font-medium">Billing address</p>
              <FormField
                control={form.control}
                name="line1"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address line 1</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Jalan Example" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="line2"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address line 2</FormLabel>
                    <FormControl>
                      <Input placeholder="Unit / floor (optional)" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input placeholder="Kuala Lumpur" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      {stateOptions.length > 0 ? (
                        <Select
                          value={field.value || NONE}
                          onValueChange={(v) =>
                            field.onChange(v === NONE ? "" : v)
                          }
                          items={[
                            { value: NONE, label: "None" },
                            ...stateOptions.map((s) => ({ value: s, label: s })),
                          ]}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select state…" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NONE}>None</SelectItem>
                            {stateOptions.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <FormControl>
                          <Input placeholder="Selangor" {...field} />
                        </FormControl>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="postcode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Postcode</FormLabel>
                      <FormControl>
                        <Input placeholder="50000" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Country</FormLabel>
                      {countries.length > 0 ? (
                        <Select
                          value={field.value || ""}
                          onValueChange={(v) => {
                            field.onChange(v ?? "")
                            // States are country-scoped — clear the old one.
                            form.setValue("state", "")
                          }}
                          items={countries.map((c) => ({
                            value: c.name,
                            label: c.name,
                          }))}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select country…" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {countries.map((c) => (
                              <SelectItem key={c.name} value={c.name}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <FormControl>
                          {/* Free-text fallback when no country picklist is
                              configured. The hint is prefixed "e.g." so it
                              reads as guidance, never a pre-filled value. */}
                          <Input placeholder="e.g. Malaysia" {...field} />
                        </FormControl>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </form>
        </Form>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            type="submit"
            form="account-form"
            disabled={form.formState.isSubmitting}
          >
            {editing ? "Save changes" : "Create account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      <AccountQuickCreate
        open={accountCreate.open}
        onOpenChange={(o) => setAccountCreate((s) => ({ ...s, open: o }))}
        defaultName={accountCreate.name}
        onCreated={(rec) => {
          if (accountCreate.target === "parent") {
            setParentOptionsState((prev) => [...prev, rec])
            form.setValue("parentAccountId", rec.id)
          } else {
            setEndUserOptionsState((prev) => [...prev, rec])
            form.setValue("endUserAccountId", rec.id, { shouldValidate: true })
          }
        }}
      />
    </>
  )
}
