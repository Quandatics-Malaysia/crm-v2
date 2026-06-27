"use client"

import * as React from "react"
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
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { createPerson } from "@/app/(app)/persons/actions"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
})

type FormValues = z.infer<typeof schema>

/**
 * Minimal "add on the fly" dialog for a Contact (a person under an account),
 * opened from an entity picker's inline "+ Create" row. A contact always lives
 * under an account, so this requires an `accountId` and is only usable once one
 * is chosen. Captures only the required Name; the user fills the rest later on
 * the contact page. On success it hands the new {id,name} back so the caller can
 * select it and append it to the picker's options.
 */
export function ContactQuickCreate({
  open,
  onOpenChange,
  accountId,
  defaultName,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The account the new contact belongs to. The dialog won't submit without it. */
  accountId: string
  defaultName?: string
  onCreated: (rec: { id: string; name: string }) => void
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: defaultName ?? "" },
  })

  // Re-seed with the typed text each time the dialog opens.
  React.useEffect(() => {
    if (open) form.reset({ name: defaultName ?? "" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultName])

  async function onSubmit(values: FormValues) {
    if (!accountId) {
      toast.error("Pick an account first")
      return
    }
    const res = await createPerson({ accountId, firstName: values.name })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success("Contact created")
    onCreated({ id: res.data.id, name: res.data.firstName })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
          <DialogDescription>
            Create a contact with just a name — add the rest later on the contact
            page.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Jane Doe" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Create contact
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
