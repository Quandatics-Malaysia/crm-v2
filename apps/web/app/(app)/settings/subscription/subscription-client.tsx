"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { showActionError } from "@/lib/show-action-error"

import { issueSeatLicence, type SubscriptionAdminView } from "./actions"

function today() {
  return new Date().toISOString().slice(0, 10)
}

function addPeriod(start: string, months: number, days = 0) {
  const date = new Date(`${start}T00:00:00Z`)
  if (months) date.setUTCMonth(date.getUTCMonth() + months)
  if (days) date.setUTCDate(date.getUTCDate() + days - 1)
  else date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function formatMoney(currency: string, value: number) {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency }).format(value)
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-MY", { dateStyle: "medium" }).format(new Date(value))
    : "—"
}

export function SubscriptionClient({ data }: { data: SubscriptionAdminView }) {
  const router = useRouter()
  const initialStart = today()
  const [busy, setBusy] = React.useState(false)
  const [plan, setPlan] = React.useState(data.plan || "Starter")
  const [seats, setSeats] = React.useState(String(data.seatLimit ?? 1))
  const [startsAt, setStartsAt] = React.useState(initialStart)
  const [endsAt, setEndsAt] = React.useState(addPeriod(initialStart, 1))
  const [seatPrice, setSeatPrice] = React.useState("")
  const [taxRate, setTaxRate] = React.useState("0")
  const [dueAt, setDueAt] = React.useState("")
  const [notes, setNotes] = React.useState("")

  const seatCount = Number(seats)
  const price = Number(seatPrice)
  const tax = Number(taxRate)
  const subtotal = Number.isFinite(price) && Number.isInteger(seatCount) ? price * seatCount : 0
  const total = subtotal + subtotal * (Number.isFinite(tax) ? tax / 100 : 0)
  const invalid = !plan.trim() || !Number.isInteger(seatCount) || seatCount < 1 ||
    !Number.isFinite(price) || price < 0 || !Number.isFinite(tax) || tax < 0 || tax > 100 ||
    !startsAt || !endsAt || startsAt > endsAt

  function choosePeriod(months: number, days = 0) {
    setEndsAt(addPeriod(startsAt || today(), months, days))
  }

  async function issue() {
    setBusy(true)
    try {
      const result = await issueSeatLicence({
        plan,
        seats: seatCount,
        startsAt,
        endsAt,
        seatPrice: price,
        taxRate: tax,
        dueAt: dueAt || undefined,
        notes: notes || undefined,
      })
      if (!result.ok) return showActionError(result)
      toast.success(`${seatCount} seats issued for ${startsAt} to ${endsAt}`)
      setNotes("")
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold">Seat licences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform-master controls for {data.tenantName}. Issuing an invoice grants access immediately; payment is managed separately.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>Tenant users</CardDescription><CardTitle className="text-2xl">{data.activeMemberCount}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Issued seats</CardDescription><CardTitle className="text-2xl">{data.seatLimit ?? "Not set"}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Valid from</CardDescription><CardTitle className="text-base">{data.startsAt || "Not set"}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Valid until</CardDescription><CardTitle className="text-base">{data.endsAt || "Not set"}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Issue seats and invoice</CardTitle>
          <CardDescription>
            Choose any validity period. This replaces the tenant&apos;s current seat total and grants service as soon as the invoice is issued.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5"><Label htmlFor="licence-plan">Plan</Label><Input id="licence-plan" value={plan} maxLength={120} onChange={(event) => setPlan(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="licence-seats">Seats granted</Label><Input id="licence-seats" type="number" min="1" step="1" value={seats} onChange={(event) => setSeats(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="licence-start">Valid from</Label><Input id="licence-start" type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="licence-end">Valid until</Label><Input id="licence-end" type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Quick period:</span>
            <Button type="button" size="sm" variant="outline" onClick={() => choosePeriod(0, 30)}>30 days</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => choosePeriod(6)}>6 months</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => choosePeriod(12)}>1 year</Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-1.5"><Label htmlFor="licence-price">Price per seat for this period</Label><Input id="licence-price" type="number" min="0" step="0.01" value={seatPrice} onChange={(event) => setSeatPrice(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="licence-tax">Tax rate (%)</Label><Input id="licence-tax" type="number" min="0" max="100" step="0.001" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="licence-due">Invoice due date (optional)</Label><Input id="licence-due" type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_16rem]">
            <div className="grid gap-1.5"><Label htmlFor="licence-notes">Notes</Label><Textarea id="licence-notes" value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} placeholder="Optional contract or invoice note" /></div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">Invoice total</p>
              <p className="mt-1 text-xl font-semibold">{formatMoney(data.defaultCurrency, Number.isFinite(total) ? total : 0)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{seatCount || 0} seats × {formatMoney(data.defaultCurrency, price || 0)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">No payment reference is required. Access follows the issued validity dates.</p>
            <Button disabled={busy || invalid} onClick={issue}>{busy ? "Issuing…" : "Issue invoice and seats"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Issued invoice history</CardTitle><CardDescription>Each invoice records the seat total and validity period granted to the tenant.</CardDescription></CardHeader>
        <CardContent>
          {data.invoices.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No seat invoices issued yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Plan</TableHead><TableHead>Seats</TableHead><TableHead>Validity</TableHead><TableHead>Total</TableHead><TableHead>Issued</TableHead></TableRow></TableHeader>
              <TableBody>{data.invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                  <TableCell>{invoice.plan}</TableCell>
                  <TableCell>{invoice.seats}</TableCell>
                  <TableCell className="text-xs">{invoice.startsAt} → {invoice.endsAt}</TableCell>
                  <TableCell>{formatMoney(invoice.currency, invoice.total)}</TableCell>
                  <TableCell><Badge variant="secondary">Issued</Badge><div className="mt-1 text-xs text-muted-foreground">{formatDate(invoice.issuedAt)}</div></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
