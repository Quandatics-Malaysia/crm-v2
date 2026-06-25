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
import { createProject, prefillFromOpportunity } from "./actions"

const STATUS_OPTIONS = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
]

const NONE = "__none__"

const projectSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  accountId: z.string().min(1, "Account is required"),
  opportunityId: z.string().optional(),
  value: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  status: z.enum(["planning", "active", "on_hold", "completed", "cancelled"]),
})

type ProjectFormValues = z.infer<typeof projectSchema>

type AccountOption = { id: string; name: string }
type OpportunityOption = { id: string; name: string; accountId: string }

export function ProjectCreateForm({
  accounts,
  opportunities,
  defaultAccountId,
  defaultOpportunityId,
  defaultValue,
  defaultQuotationId,
  prefillQuoteNumber,
}: {
  accounts: AccountOption[]
  opportunities: OpportunityOption[]
  defaultAccountId?: string
  defaultOpportunityId?: string
  defaultValue?: string
  defaultQuotationId?: string
  prefillQuoteNumber?: string
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)

  // The project links the source quotation when created from a funnel. This is
  // not a visible form field — it travels alongside the (editable) value.
  const [quotationId, setQuotationId] = React.useState<string | undefined>(
    defaultQuotationId
  )
  // Quote number backing the "pre-filled from quotation …" note. Cleared when
  // the funnel is changed/removed and the new funnel has no source quote.
  const [quoteNote, setQuoteNote] = React.useState<string | undefined>(
    prefillQuoteNumber
  )

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: "",
      accountId: defaultAccountId ?? "",
      opportunityId: defaultOpportunityId ?? NONE,
      value: defaultValue ?? "",
      startDate: "",
      status: "planning",
    },
  })

  async function handleSubmit(values: ProjectFormValues) {
    setSubmitting(true)
    try {
      const opportunityId =
        values.opportunityId && values.opportunityId !== NONE
          ? values.opportunityId
          : undefined
      const { id } = await createProject({
        name: values.name,
        accountId: values.accountId,
        opportunityId,
        quotationId: opportunityId ? quotationId : undefined,
        value: values.value || undefined,
        startDate: values.startDate || undefined,
        status: values.status,
      })
      toast.success("Project created")
      router.push(`/projects/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create project")
      setSubmitting(false)
    }
  }

  return (
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
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Implementation rollout" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    items={accounts.map((a) => ({
                      value: a.id,
                      label: a.name,
                    }))}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select an account…" />
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
              name="opportunityId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Funnel (optional)</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v)
                      if (!v || v === NONE) {
                        // Detach: clear the linked quote + note. Value stays as-is.
                        setQuotationId(undefined)
                        setQuoteNote(undefined)
                        return
                      }
                      // Derive the account from the chosen funnel, then re-prefill
                      // the value + linked quote from that funnel's net.
                      const opp = opportunities.find((o) => o.id === v)
                      if (opp) form.setValue("accountId", opp.accountId)
                      void prefillFromOpportunity(v).then((p) => {
                        if (!p) return
                        form.setValue("value", p.value)
                        setQuotationId(p.quotationId ?? undefined)
                        setQuoteNote(p.quoteNumber ?? undefined)
                      })
                    }}
                    items={[
                      { value: NONE, label: "None" },
                      ...opportunities.map((o) => ({
                        value: o.id,
                        label: o.name,
                      })),
                    ]}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Link a funnel…" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {opportunities.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
  )
}
