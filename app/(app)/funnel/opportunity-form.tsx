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
import type { Option, MemberOption, FunnelWithStages } from "@/lib/lookups"
import {
  createOpportunity,
  updateOpportunity,
  type OpportunityListRow,
} from "./actions"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  accountId: z.string().min(1, "Account is required"),
  primaryPersonId: z.string().optional(),
  funnelId: z.string().min(1, "Pipeline is required"),
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
    try {
      if (mode === "create") {
        const { id } = await createOpportunity({
          name: values.name,
          accountId: values.accountId,
          primaryPersonId: values.primaryPersonId || null,
          funnelId: values.funnelId,
          currentStageId: values.currentStageId,
          ownerMemberId: values.ownerMemberId,
          currency: values.currency,
          expectedCloseDate: values.expectedCloseDate || null,
        })
        toast.success("Funnel created")
        setOpen(false)
        router.push(`/funnel/${id}`)
      } else if (opportunity) {
        await updateOpportunity(opportunity.id, {
          name: values.name,
          accountId: values.accountId,
          primaryPersonId: values.primaryPersonId || null,
          ownerMemberId: values.ownerMemberId,
          currency: values.currency,
          expectedCloseDate: values.expectedCloseDate || null,
        })
        toast.success("Funnel updated")
        setOpen(false)
        router.refresh()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong")
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={trigger ?? <Button>New funnel</Button>}
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New funnel" : "Edit funnel"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a deal and place it on the pipeline."
              : "Update this funnel's details."}
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
                  <FormLabel>Name</FormLabel>
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
                    <FormLabel>Account</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v)
                        form.setValue("primaryPersonId", "")
                      }}
                      items={accounts.map((a) => ({
                        value: a.id,
                        label: a.name,
                      }))}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Pick an account…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
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
                name="primaryPersonId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primary contact</FormLabel>
                    <Select
                      value={field.value || ""}
                      onValueChange={field.onChange}
                      disabled={!selectedAccountId || personOptions.length === 0}
                      items={personOptions.map((p) => ({
                        value: p.id,
                        label: p.name,
                      }))}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              !selectedAccountId
                                ? "Pick an account first"
                                : "Optional"
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {personOptions.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                      <FormLabel>Pipeline</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(v) => {
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
                        items={funnels.map((f) => ({
                          value: f.id,
                          label: `${f.name}${f.isDefault ? " (default)" : ""}`,
                        }))}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pick a pipeline…" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {funnels.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.name}
                              {f.isDefault ? " (default)" : ""}
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
                  name="currentStageId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stage</FormLabel>
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
                  <FormLabel>Owner</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    items={members.map((m) => ({
                      value: m.memberId,
                      label: m.name,
                    }))}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Pick an owner…" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {members.map((m) => (
                        <SelectItem key={m.memberId} value={m.memberId}>
                          {m.name}
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
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <FormControl>
                    <Input maxLength={3} {...field} />
                  </FormControl>
                  <FormDescription>
                    The funnel&apos;s value is set by its primary quotation
                    (net).
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
