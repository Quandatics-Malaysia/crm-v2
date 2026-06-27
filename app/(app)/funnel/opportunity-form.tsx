"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  expectedCloseDate: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

export function OpportunityForm({
  mode,
  accounts,
  persons,
  members,
  funnels,
  defaultOwnerMemberId,
  opportunity,
  trigger,
}: {
  mode: "create" | "edit"
  accounts: Option[]
  persons: (Option & { accountId: string })[]
  members: MemberOption[]
  funnels: FunnelWithStages[]
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
          expectedCloseDate: opportunity.expectedCloseDate ?? "",
        }
      : {
          name: "",
          accountId: "",
          primaryPersonId: "",
          funnelId: defaultFunnel?.id ?? "",
          currentStageId: firstOpenStage?.id ?? "",
          ownerMemberId: defaultOwnerMemberId ?? "",
          currency: "MYR",
          expectedCloseDate: "",
        },
  })

  const selectedAccountId = form.watch("accountId")
  const selectedFunnelId = form.watch("funnelId")

  const personOptions = React.useMemo(
    () => persons.filter((p) => p.accountId === selectedAccountId),
    [persons, selectedAccountId]
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
        expectedCloseDate: values.expectedCloseDate || null,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Opportunity created")
      setOpen(false)
      router.push(`/funnel/${res.data.id}`)
    } else if (opportunity) {
      const res = await updateOpportunity(opportunity.id, {
        name: values.name,
        accountId: values.accountId,
        primaryPersonId: values.primaryPersonId || null,
        ownerMemberId: values.ownerMemberId,
        currency: values.currency,
        expectedCloseDate: values.expectedCloseDate || null,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Opportunity updated")
      setOpen(false)
      router.refresh()
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={trigger ?? <Button>New opportunity</Button>}
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New opportunity" : "Edit opportunity"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create an opportunity and place it on a funnel."
              : "Update this opportunity's details."}
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
                        options={accounts.map((a) => ({
                          value: a.id,
                          label: a.name,
                        }))}
                        placeholder="Pick an account…"
                        searchPlaceholder="Search accounts…"
                        emptyMessage="No accounts found."
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
                        disabled={
                          !selectedAccountId || personOptions.length === 0
                        }
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
                      : "The opportunity's value is set by its primary quotation (net)."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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
  )
}
