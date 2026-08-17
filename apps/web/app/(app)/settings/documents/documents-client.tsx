"use client"

import * as React from "react"
import { toast } from "sonner"
import { showActionError } from "@/lib/show-action-error"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  updateQuoteDefaults,
  type TenantSettingsView,
} from "@/app/(app)/settings/actions"
import {
  QUOTE_DEFAULT_DELIVERY_MAX,
  QUOTE_DEFAULT_NOTES_MAX,
  QUOTE_DEFAULT_PAYMENT_TERM_MAX,
} from "@/app/(app)/settings/constants"

function QuoteDefaultsCard({ settings }: { settings: TenantSettingsView }) {
  const initial = {
    notes: settings.quoteDefaultNotes,
    delivery: settings.quoteDefaultDelivery,
    paymentTerm: settings.quoteDefaultPaymentTerm,
  }
  const [values, setValues] = React.useState(initial)
  const [baseline, setBaseline] = React.useState(initial)
  const [isPending, startTransition] = React.useTransition()
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline)

  function save() {
    startTransition(async () => {
      const result = await updateQuoteDefaults(values)
      if (!result.ok) {
        showActionError(result)
        return
      }
      const next = {
        notes: result.data.quoteDefaultNotes,
        delivery: result.data.quoteDefaultDelivery,
        paymentTerm: result.data.quoteDefaultPaymentTerm,
      }
      setValues(next)
      setBaseline(next)
      toast.success("Quotation defaults saved")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quotation defaults</CardTitle>
        <CardDescription>
          Prefill new quotation Notes, Delivery, and Payment Term fields. Values
          remain editable on each quotation.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
        >
        <label className="grid gap-2 text-sm font-medium">
          Notes
          <Textarea
            value={values.notes}
            onChange={(event) => setValues((prev) => ({ ...prev, notes: event.target.value }))}
            maxLength={QUOTE_DEFAULT_NOTES_MAX}
            rows={4}
            placeholder="Notes copied to new quotations"
          />
          <span className="text-xs text-muted-foreground">Maximum {QUOTE_DEFAULT_NOTES_MAX} characters.</span>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Delivery
          <Textarea
            value={values.delivery}
            onChange={(event) => setValues((prev) => ({ ...prev, delivery: event.target.value }))}
            maxLength={QUOTE_DEFAULT_DELIVERY_MAX}
            rows={3}
            placeholder="Delivery terms copied to new quotations"
          />
          <span className="text-xs text-muted-foreground">Maximum {QUOTE_DEFAULT_DELIVERY_MAX} characters.</span>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Payment Term
          <Textarea
            value={values.paymentTerm}
            onChange={(event) => setValues((prev) => ({ ...prev, paymentTerm: event.target.value }))}
            maxLength={QUOTE_DEFAULT_PAYMENT_TERM_MAX}
            rows={2}
            placeholder="e.g. 30 days from invoice date"
          />
          <span className="text-xs text-muted-foreground">Maximum {QUOTE_DEFAULT_PAYMENT_TERM_MAX} characters.</span>
        </label>
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending || !dirty}>
            {isPending ? "Saving…" : "Save quotation defaults"}
          </Button>
        </div>
        </form>
      </CardContent>
    </Card>
  )
}

export function DocumentsClient({ settings }: { settings: TenantSettingsView }) {
  return (
    <div className="grid gap-6">
      <QuoteDefaultsCard settings={settings} />
    </div>
  )
}
