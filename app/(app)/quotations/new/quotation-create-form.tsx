"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createQuotation } from "../actions"

type OpportunityOption = { id: string; name: string }

export function QuotationCreateForm({
  opportunities,
  defaultOpportunityId,
}: {
  opportunities: OpportunityOption[]
  defaultOpportunityId?: string
}) {
  const router = useRouter()
  const [opportunityId, setOpportunityId] = React.useState(
    defaultOpportunityId ?? ""
  )
  const [creating, setCreating] = React.useState(false)

  async function onCreate() {
    if (!opportunityId) {
      toast.error("Select a funnel")
      return
    }
    setCreating(true)
    try {
      const q = await createQuotation({
        opportunityId,
        taxSettingId: null,
        validUntil: null,
        notes: null,
        lines: [],
      })
      toast.success("Quotation created")
      router.push(`/quotations/${q.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed")
      setCreating(false)
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-base">Quotation details</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label>Funnel</Label>
          <Select
            value={opportunityId}
            onValueChange={(v) => setOpportunityId(v ?? "")}
            items={opportunities.map((o) => ({ value: o.id, label: o.name }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a funnel…" />
            </SelectTrigger>
            <SelectContent>
              {opportunities.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/quotations")}
          >
            Cancel
          </Button>
          <Button onClick={onCreate} disabled={creating}>
            {creating ? "Creating…" : "Create draft"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
