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
import { createAccount } from "@/app/(app)/accounts/actions"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
})

type FormValues = z.infer<typeof schema>

/**
 * Minimal "add on the fly" dialog for an Account, opened from an entity picker's
 * inline "+ Create" row. Captures only the required Name (account type defaults
 * to "client" in createAccount); the user fills the rest later on the account
 * page. On success it hands the new {id,name} back so the caller can select it
 * and append it to the picker's options.
 */
export function AccountQuickCreate({
  open,
  onOpenChange,
  defaultName,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
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
    const res = await createAccount({ name: values.name })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success("Account created")
    onCreated({ id: res.data.id, name: res.data.name })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>
            Create a customer account with just a name — add the rest later on
            the account page.
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
                    <Input placeholder="Acme Corp" autoFocus {...field} />
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
                Create account
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
