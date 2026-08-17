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
import { Combobox } from "@/components/ui/combobox"
import type { Lead, LeadInput } from "./actions"

/** Sentinel: no source picked. */
const NO_SOURCE = "__none__"

import { LEAD_STATUS_OPTIONS as STATUS_OPTIONS } from "@/lib/status-meta"

const leadSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  companyName: z.string().trim().min(1, "Company is required"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  phone: z.string().trim().min(1, "Phone is required"),
  source: z.string().trim().optional(),
  status: z.enum(["new", "contacted", "qualified", "disqualified", "converted"]),
})

export type LeadFormValues = z.infer<typeof leadSchema>

export function LeadForm({
  lead,
  sources = [],
  phonePrefix = "",
  onSubmit,
  submitLabel = "Save",
}: {
  lead?: Lead
  /** Tenant lead-source picklist (Settings); empty falls back to free text. */
  sources?: string[]
  /** Tenant dialing prefix prefilled into the phone field on create. */
  phonePrefix?: string
  onSubmit: (values: LeadInput) => Promise<void>
  submitLabel?: string
}) {
  const [submitting, setSubmitting] = React.useState(false)

  // Keep a stored source selectable even if it was removed from the picklist.
  const sourceItems = React.useMemo(() => {
    const items = sources.map((s) => ({ value: s, label: s }))
    const cur = lead?.source
    if (cur && !items.some((i) => i.value === cur))
      items.push({ value: cur, label: cur })
    return items
  }, [sources, lead?.source])

  const form = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      name: lead?.name ?? "",
      companyName: lead?.companyName ?? "",
      email: lead?.email ?? "",
      phone: lead ? lead.phone ?? "" : phonePrefix,
      source: lead?.source ?? "",
      status: lead?.status ?? "new",
    },
  })

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
                  {sourceItems.length > 0 ? (
                    <Combobox
                      value={field.value || NO_SOURCE}
                      onChange={(v) =>
                        field.onChange(!v || v === NO_SOURCE ? "" : v)
                      }
                      options={[
                        { value: NO_SOURCE, label: "—" },
                        ...sourceItems,
                      ]}
                      placeholder="Pick a source…"
                      searchPlaceholder="Search sources…"
                      emptyMessage="No sources found."
                    />
                  ) : (
                    <Input placeholder="Website, referral…" {...field} />
                  )}
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
