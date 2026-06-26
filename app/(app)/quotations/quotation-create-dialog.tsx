"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  getQuotationFormMeta,
  type TaxOption,
} from "./actions"
import { QuotationCreateForm } from "./quotation-create-form"

/**
 * Embeddable quotation creation dialog, pre-bound to a single funnel. Reuses the
 * shared {@link QuotationCreateForm} so there is no duplicated create logic.
 */
export function QuotationCreateDialog({
  opportunityId,
  trigger,
}: {
  opportunityId: string
  trigger?: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [meta, setMeta] = React.useState<{
    taxOptions: TaxOption[]
    taxInclusive: boolean
  } | null>(null)
  const [loading, setLoading] = React.useState(false)

  // Load tax options + tenant tax mode the first time the dialog opens.
  React.useEffect(() => {
    if (!open || meta || loading) return
    setLoading(true)
    getQuotationFormMeta()
      .then(setMeta)
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : "Failed to load tax settings")
      )
      .finally(() => setLoading(false))
  }, [open, meta, loading])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          React.isValidElement(trigger) ? (
            trigger
          ) : (
            <Button>Create quotation</Button>
          )
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create quotation</DialogTitle>
          <DialogDescription>
            Add line items and pricing for this funnel.
          </DialogDescription>
        </DialogHeader>
        {meta ? (
          <QuotationCreateForm
            opportunityId={opportunityId}
            taxOptions={meta.taxOptions}
            taxInclusive={meta.taxInclusive}
            onCancel={() => setOpen(false)}
            onCreated={() => {
              setOpen(false)
              router.refresh()
            }}
          />
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {loading ? "Loading…" : "Preparing form…"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
