"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { showActionError } from "@/lib/show-action-error"
import { calculateProratedSeatCharge } from "@/lib/subscription-proration"

import {
  createSubscriptionInvoice,
  issueSubscriptionInvoice,
  markSubscriptionInvoicePaid,
  updateSubscriptionConfiguration,
  voidSubscriptionInvoice,
  type SubscriptionAdminView,
  type SubscriptionInvoiceView,
} from "./actions"

const STATUS_LABELS = {
  active: "Active",
  trial: "Trial",
  paused: "Paused",
  expired: "Expired",
  cancelled: "Cancelled",
} as const

function formatMoney(currency: string, value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

function formatDate(value: string | null) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium" }).format(
    new Date(value)
  )
}

function statusVariant(status: SubscriptionInvoiceView["status"]) {
  if (status === "paid") return "default" as const
  if (status === "void") return "destructive" as const
  if (status === "issued") return "secondary" as const
  return "outline" as const
}

export function SubscriptionClient({ data }: { data: SubscriptionAdminView }) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [plan, setPlan] = React.useState(data.plan)
  const [status, setStatus] = React.useState(data.status)
  const [startsAt, setStartsAt] = React.useState(data.startsAt)
  const [endsAt, setEndsAt] = React.useState(data.endsAt)
  const [additionalSeats, setAdditionalSeats] = React.useState("1")
  const [seatPrice, setSeatPrice] = React.useState("")
  const [taxRate, setTaxRate] = React.useState("0")
  const [dueAt, setDueAt] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [paymentReferences, setPaymentReferences] = React.useState<Record<string, string>>({})

  const seats = Number(additionalSeats)
  const price = Number(seatPrice)
  const tax = Number(taxRate)
  const subtotal = calculateProratedSeatCharge({
    seatPrice: Number.isFinite(price) ? price : 0,
    additionalSeats: Number.isInteger(seats) ? seats : 0,
    startsAt: data.startsAt ? new Date(`${data.startsAt}T00:00:00Z`) : null,
    endsAt: data.endsAt ? new Date(`${data.endsAt}T23:59:59.999Z`) : null,
  })
  const previewTotal = subtotal + subtotal * (Number.isFinite(tax) ? tax / 100 : 0)

  function refreshWith(message: string) {
    toast.success(message)
    router.refresh()
  }

  function saveConfiguration() {
    startTransition(async () => {
      const result = await updateSubscriptionConfiguration({ plan, status, startsAt, endsAt })
      if (!result.ok) return showActionError(result)
      refreshWith("Subscription configuration saved")
    })
  }

  function createInvoice() {
    startTransition(async () => {
      const result = await createSubscriptionInvoice({
        additionalSeats: seats,
        seatPriceFullTerm: price,
        taxRate: tax,
        dueAt,
        notes: notes || undefined,
      })
      if (!result.ok) return showActionError(result)
      setAdditionalSeats("1")
      setSeatPrice("")
      setTaxRate("0")
      setDueAt("")
      setNotes("")
      refreshWith(`Draft ${result.data.invoiceNumber} created`)
    })
  }

  function issue(invoice: SubscriptionInvoiceView) {
    startTransition(async () => {
      const result = await issueSubscriptionInvoice(invoice.id)
      if (!result.ok) return showActionError(result)
      refreshWith(`${invoice.invoiceNumber} issued`)
    })
  }

  function markPaid(invoice: SubscriptionInvoiceView) {
    startTransition(async () => {
      const result = await markSubscriptionInvoicePaid(
        invoice.id,
        paymentReferences[invoice.id] ?? ""
      )
      if (!result.ok) return showActionError(result)
      refreshWith(
        `${invoice.invoiceNumber} paid; ${invoice.additionalSeats} seats activated`
      )
    })
  }

  function voidInvoice(invoice: SubscriptionInvoiceView) {
    startTransition(async () => {
      const result = await voidSubscriptionInvoice(invoice.id)
      if (!result.ok) return showActionError(result)
      refreshWith(`${invoice.invoiceNumber} voided`)
    })
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold">Subscription</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform-master controls for {data.tenantName}. Tenant owners cannot change these settings.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active members</CardDescription>
            <CardTitle className="text-2xl">{data.activeMemberCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Licensed seats</CardDescription>
            <CardTitle className="text-2xl">{data.seatLimit ?? "Unlimited"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Seats available</CardDescription>
            <CardTitle className="text-2xl">
              {data.seatLimit == null ? "Unlimited" : Math.max(0, data.seatLimit - data.activeMemberCount)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plan and term</CardTitle>
          <CardDescription>
            Define when this tenant may use the platform. Seat limits change only when an issued invoice is marked paid.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="subscription-plan">Plan</Label>
              <Input id="subscription-plan" value={plan} maxLength={120} onChange={(event) => setPlan(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="subscription-start">Start date</Label>
              <Input id="subscription-start" type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="subscription-end">End date</Label>
              <Input id="subscription-end" type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button disabled={isPending || !plan.trim() || !startsAt || !endsAt} onClick={saveConfiguration}>
              {isPending ? "Saving…" : "Save plan and term"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create seat invoice</CardTitle>
          <CardDescription>
            The price is per seat for the full term. The invoice is prorated to the term end date and starts as a draft.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {data.seatLimit == null ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              This tenant currently has unlimited seats. Its first paid invoice will replace unlimited access with the purchased seat count and must cover all active members.
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-seats">Seats to add</Label>
              <Input id="invoice-seats" type="number" min="1" step="1" value={additionalSeats} onChange={(event) => setAdditionalSeats(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-price">Price per seat / full term</Label>
              <Input id="invoice-price" type="number" min="0" step="0.01" value={seatPrice} onChange={(event) => setSeatPrice(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-tax">Tax rate (%)</Label>
              <Input id="invoice-tax" type="number" min="0" max="100" step="0.001" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-due">Due date</Label>
              <Input id="invoice-due" type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_16rem]">
            <div className="grid gap-1.5">
              <Label htmlFor="invoice-notes">Notes</Label>
              <Textarea id="invoice-notes" maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional commercial or payment notes" />
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">Prorated invoice total</p>
              <p className="mt-1 text-xl font-semibold">{formatMoney(data.defaultCurrency, Number.isFinite(previewTotal) ? previewTotal : 0)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Subtotal {formatMoney(data.defaultCurrency, subtotal)}</p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button disabled={isPending || !Number.isInteger(seats) || seats < 1 || !Number.isFinite(price) || price < 0 || !Number.isFinite(tax) || tax < 0 || tax > 100 || !data.startsAt || !data.endsAt || !dueAt} onClick={createInvoice}>
              {isPending ? "Creating…" : "Create draft invoice"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice history</CardTitle>
          <CardDescription>
            Issue a draft after review. Marking an issued invoice paid activates its seats exactly once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.invoices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No subscription invoices yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead>Seats</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Due / paid</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>
                      <div className="font-medium">{invoice.invoiceNumber}</div>
                      <div className="text-xs text-muted-foreground">{invoice.plan}</div>
                    </TableCell>
                    <TableCell><Badge variant={statusVariant(invoice.status)} className="capitalize">{invoice.status}</Badge></TableCell>
                    <TableCell className="text-xs">{invoice.subscriptionStartsAt}<br />{invoice.subscriptionEndsAt}</TableCell>
                    <TableCell>+{invoice.additionalSeats}</TableCell>
                    <TableCell>{formatMoney(invoice.currency, invoice.total)}</TableCell>
                    <TableCell className="text-xs">
                      {invoice.paidAt ? `Paid ${formatDate(invoice.paidAt)}` : formatDate(invoice.dueAt)}
                      {invoice.paymentReference ? <div className="max-w-36 truncate text-muted-foreground">{invoice.paymentReference}</div> : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-56 justify-end gap-2">
                        {invoice.status === "draft" ? (
                          <Button size="sm" disabled={isPending} onClick={() => issue(invoice)}>Issue</Button>
                        ) : null}
                        {invoice.status === "issued" ? (
                          <>
                            <Input
                              className="h-8 w-32"
                              aria-label={`Payment reference for ${invoice.invoiceNumber}`}
                              placeholder="Payment ref"
                              maxLength={200}
                              value={paymentReferences[invoice.id] ?? ""}
                              onChange={(event) => setPaymentReferences((current) => ({ ...current, [invoice.id]: event.target.value }))}
                            />
                            <Button size="sm" disabled={isPending || !(paymentReferences[invoice.id] ?? "").trim()} onClick={() => markPaid(invoice)}>Mark paid</Button>
                          </>
                        ) : null}
                        {invoice.status === "draft" || invoice.status === "issued" ? (
                          <Button size="sm" variant="outline" disabled={isPending} onClick={() => voidInvoice(invoice)}>Void</Button>
                        ) : null}
                        {invoice.status === "paid" || invoice.status === "void" ? <span className="text-xs text-muted-foreground">No actions</span> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
