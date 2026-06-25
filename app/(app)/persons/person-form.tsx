"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
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
import type { Option } from "@/lib/lookups"
import { createPerson, updatePerson, type PersonRow } from "./actions"

const schema = z.object({
  accountId: z.string().min(1, "Account is required"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
  title: z.string().optional(),
  email: z.union([z.string().email("Invalid email"), z.literal("")]).optional(),
  phone: z.string().optional(),
  isPrimary: z.boolean(),
})

type FormValues = z.infer<typeof schema>

export function PersonForm({
  accounts,
  person,
  presetAccountId,
  trigger,
  open: controlledOpen,
  onOpenChange,
  onSaved,
}: {
  /** Account options for the select. Omit when presetAccountId is set + locked. */
  accounts?: Option[]
  /** Existing person to edit; omit to create. */
  person?: PersonRow
  /** Lock the contact to this account (e.g. on an account detail page). */
  presetAccountId?: string
  /** Render-prop trigger. Omit when controlling open externally. */
  trigger?: React.ReactNode
  /** Controlled open state (when no trigger is provided). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSaved?: () => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (isControlled) onOpenChange?.(next)
      else setUncontrolledOpen(next)
    },
    [isControlled, onOpenChange]
  )
  const editing = !!person

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      accountId: person?.accountId ?? presetAccountId ?? "",
      firstName: person?.firstName ?? "",
      lastName: person?.lastName ?? "",
      title: person?.title ?? "",
      email: person?.email ?? "",
      phone: person?.phone ?? "",
      isPrimary: person?.isPrimary ?? false,
    },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({
        accountId: person?.accountId ?? presetAccountId ?? "",
        firstName: person?.firstName ?? "",
        lastName: person?.lastName ?? "",
        title: person?.title ?? "",
        email: person?.email ?? "",
        phone: person?.phone ?? "",
        isPrimary: person?.isPrimary ?? false,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const accountLocked = !!presetAccountId && !editing

  async function onSubmit(values: FormValues) {
    try {
      const payload = {
        accountId: values.accountId,
        firstName: values.firstName,
        lastName: values.lastName || null,
        title: values.title || null,
        email: values.email || null,
        phone: values.phone || null,
        isPrimary: values.isPrimary,
      }
      if (editing) {
        await updatePerson(person!.id, payload)
        toast.success("Contact updated")
      } else {
        await createPerson(payload)
        toast.success("Contact created")
      }
      setOpen(false)
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger render={trigger as React.ReactElement} />
      ) : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit contact" : "New contact"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            id="person-form"
          >
            {!accountLocked && accounts ? (
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
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input placeholder="Jane" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input placeholder="Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="VP of Engineering" {...field} />
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
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="jane@example.com"
                        {...field}
                      />
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
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input placeholder="+60 12-345 6789" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="isPrimary"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-2">
                  <FormLabel className="font-normal">
                    Primary contact for this account
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
          </form>
        </Form>

        <DialogFooter>
          <Button
            type="submit"
            form="person-form"
            disabled={form.formState.isSubmitting}
          >
            {editing ? "Save changes" : "Create contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
