"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { PhoneInput } from "@/components/phone-input"
import { Combobox } from "@/components/ui/combobox"
import { AccountQuickCreate } from "@/components/quick-create-account"
import type { Option } from "@/lib/lookups"
import { createPerson, updatePerson, type PersonRow } from "./actions"
import { isValidPhoneE164, toPhoneE164 } from "@/lib/phone-validation"

const schema = (country: string) => z.object({
  accountId: z.string().min(1, "Account is required"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
  title: z.string().optional(),
  department: z.string().optional(),
  email: z.union([z.string().email("Invalid email"), z.literal("")]).optional(),
  phone: z
    .string()
    .optional()
    .refine(
      (v) => isValidPhoneE164(v, country),
      { message: "Enter a valid phone number for the selected country." }
    ),
  defaultCountry: z.string().optional(),
  isPrimary: z.boolean(),
})

type FormValues = z.infer<ReturnType<typeof schema>>

export function PersonForm({
  accounts,
  person,
  presetAccountId,
  phonePrefix,
  defaultCountry,
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
  /** Tenant dialing prefix prefilled into the phone field on create. */
  phonePrefix?: string
  defaultCountry?: string
  /** Render-prop trigger. Omit when controlling open externally. */
  trigger?: React.ReactNode
  /** Controlled open state (when no trigger is provided). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSaved?: () => void
}) {
  const [open, setOpen] = useDialogOpen(controlledOpen, onOpenChange)
  const editing = !!person

  const form = useForm<FormValues>({
    resolver: zodResolver(schema(defaultCountry ?? "MY")),
    mode: "onBlur",
    defaultValues: {
      accountId: person?.accountId ?? presetAccountId ?? "",
      firstName: person?.firstName ?? "",
      lastName: person?.lastName ?? "",
      title: person?.title ?? "",
      department: person?.department ?? "",
      email: person?.email ?? "",
      phone: person ? person.phone ?? "" : phonePrefix ?? "",
      isPrimary: person?.isPrimary ?? false,
      defaultCountry: defaultCountry ?? "MY",
    },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({
        accountId: person?.accountId ?? presetAccountId ?? "",
        firstName: person?.firstName ?? "",
        lastName: person?.lastName ?? "",
        title: person?.title ?? "",
        department: person?.department ?? "",
        email: person?.email ?? "",
        phone: person ? person.phone ?? "" : phonePrefix ?? "",
        isPrimary: person?.isPrimary ?? false,
        defaultCountry: defaultCountry ?? "MY",
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const accountLocked = !!presetAccountId && !editing

  // Account options become local state so inline "+ Create" can append the new
  // account and have it immediately selectable.
  const [accountOptions, setAccountOptions] = React.useState(accounts ?? [])
  const [accountCreate, setAccountCreate] = React.useState<{
    open: boolean
    name: string
  }>({ open: false, name: "" })

  async function onSubmit(values: FormValues) {
    const payload = {
      accountId: values.accountId,
      firstName: values.firstName,
      lastName: values.lastName || null,
      title: values.title || null,
      department: values.department || null,
      email: values.email || null,
      phone: toPhoneE164(values.phone, values.defaultCountry) || null,
      isPrimary: values.isPrimary,
    }
    const res = editing
      ? await updatePerson(person!.id, payload)
      : await createPerson(payload)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success(editing ? "Contact updated" : "Contact created")
    setOpen(false)
    onSaved?.()
  }

  return (
    <>
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
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>First name</FormLabel>
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
            <FormField
              control={form.control}
              name="department"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Department</FormLabel>
                  <FormControl>
                    <Input placeholder="Commercial" {...field} />
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
                  <PhoneInput
                    value={field.value}
                    onChange={field.onChange}
                    label="Phone"
                    placeholder="012 345 6789"
                    defaultCountry={form.getValues("defaultCountry") as string}
                  />
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
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancel
          </DialogClose>
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
