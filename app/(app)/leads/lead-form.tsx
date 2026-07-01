"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DialogClose } from "@/components/ui/dialog"
import type { FunnelWithStages } from "@/lib/lookups"
import type { Lead, LeadInput } from "./actions"

const STATUS_OPTIONS: { value: Lead["status"]; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "disqualified", label: "Disqualified" },
  { value: "converted", label: "Converted" },
]

const NONE = "__none__"

const leadSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  companyName: z.string().trim().min(1, "Company is required"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  phone: z.string().trim().min(1, "Phone is required"),
  source: z.string().trim().optional(),
  status: z.enum(["new", "contacted", "qualified", "disqualified", "converted"]),
  funnelId: z.string(),
  currentStageId: z.string(),
})

export type LeadFormValues = z.infer<typeof leadSchema>

export function LeadForm({
  lead,
  funnels,
  onSubmit,
  submitLabel = "Save",
}: {
  lead?: Lead
  funnels: FunnelWithStages[]
  onSubmit: (values: LeadInput) => Promise<void>
  submitLabel?: string
}) {
  const [submitting, setSubmitting] = React.useState(false)

  const form = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      name: lead?.name ?? "",
      companyName: lead?.companyName ?? "",
      email: lead?.email ?? "",
      phone: lead?.phone ?? "",
      source: lead?.source ?? "",
      status: lead?.status ?? "new",
      funnelId: lead?.funnelId ?? NONE,
      currentStageId: lead?.currentStageId ?? NONE,
    },
  })

  const funnelId = form.watch("funnelId")
  const stages = React.useMemo(
    () => funnels.find((f) => f.id === funnelId)?.stages ?? [],
    [funnels, funnelId]
  )

  const funnelItems = React.useMemo(
    () => [
      { value: NONE, label: "No funnel" },
      ...funnels.map((f) => ({ value: f.id, label: f.name })),
    ],
    [funnels]
  )
  const stageItems = React.useMemo(
    () => [
      { value: NONE, label: "No stage" },
      ...stages.map((s) => ({ value: s.id, label: s.name })),
    ],
    [stages]
  )

  async function handleSubmit(values: LeadFormValues) {
    setSubmitting(true)
    try {
      await onSubmit({
        name: values.name,
        companyName: values.companyName || null,
        email: values.email || null,
        phone: values.phone || null,
        source: values.source || null,
        status: values.status,
        funnelId: values.funnelId === NONE ? null : values.funnelId,
        currentStageId:
          values.currentStageId === NONE ? null : values.currentStageId,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>Name</FormLabel>
              <FormControl>
                <Input placeholder="Jane Doe" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="companyName"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>Company</FormLabel>
              <FormControl>
                <Input placeholder="Acme Inc." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Email</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="jane@acme.com" {...field} />
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
                <FormLabel required>Phone</FormLabel>
                <FormControl>
                  <Input placeholder="+60 12-345 6789" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="source"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Source</FormLabel>
                <FormControl>
                  <Input placeholder="Website, referral…" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

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
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="funnelId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Funnel</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v ?? NONE)
                    // Reset the stage whenever the funnel changes.
                    form.setValue("currentStageId", NONE)
                  }}
                  items={funnelItems}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="No funnel" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {funnelItems.map((o) => (
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
            name="currentStageId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Stage</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(v) => field.onChange(v ?? NONE)}
                  items={stageItems}
                  disabled={funnelId === NONE}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="No stage" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {stageItems.map((o) => (
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

        <div className="-mx-4 -mb-4 mt-2 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  )
}
