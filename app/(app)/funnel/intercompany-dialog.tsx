"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { MAX_INTERCOMPANY_PARTIES } from "@/lib/interco-share"
import { showActionError } from "@/lib/show-action-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Combobox } from "@/components/ui/combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { Option } from "@/lib/lookups"
import { updateOpportunity, type PartyInput } from "./actions"

/**
 * Intercompany deal + handling-partner rows are a multi-row structured editor
 * (entity + share-type + share-value per row), not a simple field — so unlike
 * the rest of the Funnel's fields (now inline on the detail page), this stays
 * behind its own small dialog. Low-traffic: the finance module is off by
 * default, so this section doesn't even render unless it's enabled.
 */
export function IntercompanyDialog({
  funnelId,
  isIntercompany,
  parties,
  entityOptions,
  currency,
  trigger,
}: {
  funnelId: string
  isIntercompany: boolean
  parties: { partnerEntityId: string; shareType: "percent" | "amount"; shareValue: string }[]
  entityOptions: Option[]
  currency: string
  trigger: React.ReactElement
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [enabled, setEnabled] = React.useState(isIntercompany)
  const [rows, setRows] = React.useState<PartyInput[]>(parties)
  const [submitting, setSubmitting] = React.useState(false)

  function onOpenChange(next: boolean) {
    if (next) {
      setEnabled(isIntercompany)
      setRows(parties)
    }
    setOpen(next)
  }

  async function onSave() {
    setSubmitting(true)
    try {
      const res = await updateOpportunity(funnelId, {
        isIntercompany: enabled,
        parties: enabled ? rows : [],
      })
      if (!res.ok) {
        showActionError(res)
        return
      }
      toast.success("Intercompany settings updated")
      setOpen(false)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Intercompany deal</DialogTitle>
          <DialogDescription>
            A partner entity handles delivery; we&apos;re the contracting
            middle-man and recognize only our cut.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm font-medium">Intercompany deal</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {enabled ? (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Handling partner{rows.length !== 1 ? "s" : ""}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={rows.length >= MAX_INTERCOMPANY_PARTIES}
                  onClick={() =>
                    setRows((r) => [
                      ...r,
                      { partnerEntityId: "", shareType: "amount", shareValue: "" },
                    ])
                  }
                >
                  <Plus className="size-4" /> Add party
                </Button>
              </div>

              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No parties yet — add one above.
                </p>
              ) : (
                rows.map((row, index) => {
                  const chosenElsewhere = rows
                    .filter((_, i) => i !== index)
                    .map((p) => p.partnerEntityId)
                  return (
                    <div
                      key={index}
                      className="grid grid-cols-[1fr_auto_1fr_auto] items-start gap-2"
                    >
                      <Combobox
                        value={row.partnerEntityId}
                        onChange={(v) =>
                          setRows((r) =>
                            r.map((p, i) => (i === index ? { ...p, partnerEntityId: v } : p))
                          )
                        }
                        options={entityOptions
                          .filter((e) => !chosenElsewhere.includes(e.id))
                          .map((e) => ({ value: e.id, label: e.name }))}
                        placeholder="Select entity"
                        searchPlaceholder="Search entities…"
                        emptyMessage="No other entities."
                      />
                      <Select
                        value={row.shareType}
                        onValueChange={(v) =>
                          setRows((r) =>
                            r.map((p, i) =>
                              i === index ? { ...p, shareType: v as "amount" | "percent" } : p
                            )
                          )
                        }
                      >
                        <SelectTrigger className="w-[90px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="amount">Amount</SelectItem>
                          <SelectItem value="percent">Percent</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.shareValue}
                        placeholder={row.shareType === "percent" ? "0-100%" : `0.00 ${currency}`}
                        onChange={(e) =>
                          setRows((r) =>
                            r.map((p, i) =>
                              i === index ? { ...p, shareValue: e.target.value } : p
                            )
                          )
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove party"
                        onClick={() => setRows((r) => r.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )
                })
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={submitting}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
