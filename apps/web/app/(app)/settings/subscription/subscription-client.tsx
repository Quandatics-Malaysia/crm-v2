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
import {
  buildCollectionMilestones,
  calculateContractTotal,
  countMonthlyBillingPeriods,
  type CollectionFrequency,
} from "@/lib/subscription-billing"

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
  const [endsAt, setEndsAt] = React.useState(addPeriod(initialStart, 12))
  const [seatPrice, setSeatPrice] = React.useState("")
  const [taxRate, setTaxRate] = React.useState("0")
  const [firstDueAt, setFirstDueAt] = React.useState(initialStart)
  const [collectionFrequency, setCollectionFrequency] = React.useState<CollectionFrequency>("monthly")
  const [notes, setNotes] = React.useState("")

  const seatCount = Number(seats)
  const price = Number(seatPrice)
  const tax = Number(taxRate)
  const billingPeriodCount = startsAt && endsAt && startsAt <= endsAt
    ? countMonthlyBillingPeriods(startsAt, endsAt)
    : 0
  const { subtotal, taxAmount, total } = calculateContractTotal(
    Number.isFinite(price) ? price : 0,
    Number.isInteger(seatCount) ? seatCount : 0,
    billingPeriodCount,
    Number.isFinite(tax) ? tax : 0
  )
  const milestones = firstDueAt && billingPeriodCount
    ? buildCollectionMilestones({
        frequency: collectionFrequency,
        billingPeriods: billingPeriodCount,
        firstDueAt,
        total,
      })
    : []
  const invalid = !plan.trim() || !Number.isInteger(seatCount) || seatCount < 1 ||
    !Number.isFinite(price) || price < 0 || !Number.isFinite(tax) || tax < 0 || tax > 100 ||
    !startsAt || !endsAt || startsAt > endsAt || !firstDueAt || billingPeriodCount < 1

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
        monthlySeatPrice: price,
        taxRate: tax,
        firstDueAt,
        collectionFrequency,
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
            The monthly rate is multiplied across the chosen contract term. This replaces the tenant&apos;s current seat total and grants service as soon as the invoice is issued.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5"><Label htmlFor="licence-plan">Plan</Label><Input id="licence-plan" value={plan} maxLength={120} onChange={(event) => setPlan(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="licence-seats">Seats granted</Label><Input id="licence-seats" type="number" min="1" step="1" value={seats} onChange={(event) => setSeats(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="licence-start">Valid from</Label><Input id="licence-start" type="date" value={startsAt} onChange={(event) => { setStartsAt(event.target.value); setFirstDueAt(event.target.value) }} /></div>
            <div className="grid gap-1.5"><Label htmlFor="licence-end">Valid until</Label><Input id="licence-end" type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Quick period:</span>
            <Button type="button" size="sm" variant="outline" onClick={() => choosePeriod(0, 30)}>30 days</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => choosePeriod(6)}>6 months</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => choosePeriod(12)}>1 year</Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-1.5"><Label htmlFor="licence-price">Monthly price per seat</Label><Input id="licence-price" type="number" min="0" step="0.01" value={seatPrice} onChange={(event) => setSeatPrice(event.target.value)} placeholder="250.00" /></div>
            <div className="grid gap-1.5"><Label htmlFor="licence-tax">Tax rate (%)</Label><Input id="licence-tax" type="number" min="0" max="100" step="0.001" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="licence-due">First collection date</Label><Input id="licence-due" type="date" value={firstDueAt} onChange={(event) => setFirstDueAt(event.target.value)} /></div>
          </div>
          <div className="grid gap-3 rounded-lg border p-4">
            <div>
              <h3 className="text-sm font-medium">Collection milestones</h3>
              <p className="text-xs text-muted-foreground">Choose whether to collect the contract total monthly or in one upfront milestone.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={collectionFrequency === "monthly" ? "default" : "outline"} onClick={() => setCollectionFrequency("monthly")}>Monthly · {billingPeriodCount} collections</Button>
              <Button type="button" size="sm" variant={collectionFrequency === "upfront" ? "default" : "outline"} onClick={() => setCollectionFrequency("upfront")}>Upfront · 1 collection</Button>
            </div>
            <div className="max-h-52 overflow-y-auto rounded-md border">
              {milestones.map((milestone) => (
                <div key={milestone.sequence} className="flex items-center justify-between gap-4 border-b px-3 py-2 text-sm last:border-b-0">
                  <div><span className="font-medium">{milestone.title}</span><span className="ml-2 text-muted-foreground">{milestone.dueAt}</span></div>
                  <span>{formatMoney(data.defaultCurrency, milestone.amount)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_16rem]">
            <div className="grid gap-1.5"><Label htmlFor="licence-notes">Notes</Label><Textarea id="licence-notes" value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} placeholder="Optional contract or invoice note" /></div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">Invoice total</p>
              <p className="mt-1 text-xl font-semibold">{formatMoney(data.defaultCurrency, Number.isFinite(total) ? total : 0)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{seatCount || 0} seats × {formatMoney(data.defaultCurrency, price || 0)}/month × {billingPeriodCount} months</p>
              {taxAmount ? <p className="mt-1 text-xs text-muted-foreground">Subtotal {formatMoney(data.defaultCurrency, subtotal)} + tax {formatMoney(data.defaultCurrency, taxAmount)}</p> : null}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">No payment reference is required. Access follows the issued validity dates.</p>
            <Button disabled={busy || invalid} onClick={issue}>{busy ? "Issuing…" : "Issue invoice and seats"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Issued invoice history</CardTitle><CardDescription>Each invoice records the contract value, seat total, validity period, and collection milestones.</CardDescription></CardHeader>
        <CardContent>
          {data.invoices.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No seat invoices issued yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Plan</TableHead><TableHead>Seats</TableHead><TableHead>Validity</TableHead><TableHead>Collection</TableHead><TableHead>Total</TableHead><TableHead>Issued</TableHead></TableRow></TableHeader>
              <TableBody>{data.invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                  <TableCell>{invoice.plan}</TableCell>
                  <TableCell>{invoice.seats}</TableCell>
                  <TableCell className="text-xs">{invoice.startsAt} → {invoice.endsAt}</TableCell>
                  <TableCell><div className="text-sm capitalize">{invoice.collectionFrequency}</div><div className="text-xs text-muted-foreground">{invoice.milestones.length || 1} milestone{(invoice.milestones.length || 1) === 1 ? "" : "s"}</div></TableCell>
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
