"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { showActionError } from "@/lib/show-action-error"
import {
  ArrowLeftRightIcon,
  CheckIcon,
  FolderPlusIcon,
  XIcon,
} from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { usePermissions } from "@/components/command-palette"
import { PERMISSIONS } from "@/lib/permissions"
import { formatMoney, formatDate } from "@/lib/format"
import { partyShare } from "@/lib/interco-share"
import { createProject } from "@/app/(app)/projects/actions"
import {
  respondToIntercompanyDeal,
  ensureOriginEntityAccount,
  type InboundIntercompanyDeal,
} from "./actions"

// Status pill: rendered by the app-wide <StatusBadge> tone map.

/**
 * This entity's OWN share of the deal — independent of any other party on it
 * (see lib/interco-share.ts). Basis mirrors the funnel detail rule — quoted
 * net once a quote exists, else the origin's estimate.
 */
function partnerShare(r: InboundIntercompanyDeal): {
  amount: string
  percent: number
  fixed: boolean
} {
  const basis = Number(r.quotedAmount ?? r.estimatedAmount ?? 0)
  const share = partyShare(
    { shareType: r.shareType, shareValue: Number(r.shareValue) },
    basis,
    basis
  )
  const percent = basis > 0 ? Math.round((share / basis) * 100) : 0
  return { amount: share.toFixed(2), percent, fixed: r.shareType === "amount" }
}

function DeclineDialog({
  deal,
  onOpenChange,
}: {
  deal: InboundIntercompanyDeal
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [reason, setReason] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  async function decline() {
    setBusy(true)
    try {
      const res = await respondToIntercompanyDeal(deal.id, "declined", reason)
      if (!res.ok) {
        showActionError(res)
        return
      }
      toast.success("Assignment declined")
      onOpenChange(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Decline “{deal.name}”?</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="interco-decline-reason">Reason</Label>
          <Input
            id="interco-decline-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="No delivery capacity this quarter…"
          />
          <p className="text-xs text-muted-foreground">
            The origin entity sees this on its funnel.
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={decline}
            disabled={busy || !reason.trim()}
          >
            {busy ? "Declining…" : "Decline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateDeliveryProjectDialog({
  deal,
  accountOptions,
  onOpenChange,
}: {
  deal: InboundIntercompanyDeal
  accountOptions: { id: string; name: string }[]
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const share = partnerShare(deal)
  const [name, setName] = React.useState(deal.name)
  const [accountId, setAccountId] = React.useState("")
  const [value, setValue] = React.useState(share?.amount ?? "")
  const [busy, setBusy] = React.useState(false)

  async function submit() {
    setBusy(true)
    try {
      // Auto-provision the origin-entity account when none is picked, so the
      // partner doesn't have to hand-create it first.
      let acctId = accountId
      if (!acctId) {
        const prov = await ensureOriginEntityAccount(deal.id)
        if (!prov.ok) {
          showActionError(prov)
          return
        }
        acctId = prov.data.id
      }
      const res = await createProject({
        name: name.trim() || deal.name,
        accountId: acctId,
        value: value || undefined,
        currency: deal.currency,
        intercompanyDealId: deal.id,
      })
      if (!res.ok) {
        showActionError(res)
        return
      }
      toast.success(`Project ${res.data.projectCode} created`)
      onOpenChange(false)
      router.push(`/projects/${res.data.id}`)
    } finally {
      setBusy(false)
    }
  }

  const accountItems = accountOptions.map((a) => ({
    value: a.id,
    label: a.name,
  }))

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create delivery project</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="interco-project-name">Project name</Label>
            <Input
              id="interco-project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Account</Label>
            <Select
              value={accountId}
              onValueChange={(v) => setAccountId(v ?? "")}
              items={accountItems}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={`Leave blank to auto-create ${deal.originEntityName ?? "the origin entity"}`} />
              </SelectTrigger>
              <SelectContent>
                {accountItems.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Leave blank to auto-create an account for{" "}
              {deal.originEntityName ?? "the origin entity"}, or pick an existing one.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="interco-project-value">
              Value ({deal.currency})
            </Label>
            <Input
              id="interco-project-value"
              type="number"
              step="0.01"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            {share ? (
              <p className="text-xs text-muted-foreground">
                {share.fixed
                  ? "Prefilled with your fixed leg amount for the deal."
                  : `Prefilled with your ${share.percent}% share of the deal.`}
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function IntercompanyTable({
  data,
  accountOptions,
}: {
  data: InboundIntercompanyDeal[]
  accountOptions: { id: string; name: string }[]
}) {
  const router = useRouter()
  const perms = usePermissions()
  const canCreateProject = perms.has(PERMISSIONS.PROJECT_CREATE)
  const [declineTarget, setDeclineTarget] =
    React.useState<InboundIntercompanyDeal | null>(null)
  const [projectTarget, setProjectTarget] =
    React.useState<InboundIntercompanyDeal | null>(null)

  async function accept(deal: InboundIntercompanyDeal) {
    const res = await respondToIntercompanyDeal(deal.id, "accepted")
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Assignment accepted")
    router.refresh()
  }

  const columns = React.useMemo<ColumnDef<InboundIntercompanyDeal>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Deal" />,
        cell: ({ row }) => (
          <div className="grid gap-0.5">
            <span className="font-medium">{row.original.name}</span>
            {row.original.accountName ? (
              <span className="text-xs text-muted-foreground">
                {row.original.accountName}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "originEntityName",
        accessorFn: (r) => r.originEntityName ?? "",
        header: ({ column }) => (
          <SortableHeader column={column} title="From entity" />
        ),
        cell: ({ getValue }) => {
          const v = getValue<string>()
          return v ? v : <span className="text-muted-foreground">—</span>
        },
      },
      {
        accessorKey: "status",
        header: ({ column }) => <SortableHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <StatusBadge status={row.original.status} />
            {row.original.stageName ? (
              <span className="text-xs text-muted-foreground">
                {row.original.stageName}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "response",
        accessorFn: (r) =>
          r.response === "accepted"
            ? "Accepted"
            : r.response === "declined"
              ? "Declined"
              : "Pending",
        header: "Response",
        cell: ({ row }) => {
          const r = row.original
          if (r.response === "accepted")
            return <Badge>Accepted</Badge>
          if (r.response === "declined")
            return (
              <div className="grid gap-0.5">
                <Badge variant="destructive">Declined</Badge>
                {r.responseReason ? (
                  <span
                    className="max-w-[14rem] truncate text-xs text-muted-foreground"
                    title={r.responseReason}
                  >
                    {r.responseReason}
                  </span>
                ) : null}
              </div>
            )
          return <Badge variant="outline">Pending</Badge>
        },
      },
      {
        id: "dealValue",
        accessorFn: (r) => Number(r.quotedAmount ?? r.estimatedAmount ?? 0),
        header: ({ column }) => (
          <SortableHeader column={column} title="Deal value" />
        ),
        cell: ({ row }) => {
          const r = row.original
          const basis = r.quotedAmount ?? r.estimatedAmount
          if (!basis) return <span className="text-muted-foreground">—</span>
          return (
            <span className="tabular-nums">
              {formatMoney(basis, r.currency)}
              <span className="ml-1 text-xs text-muted-foreground">
                ({r.quotedAmount ? "quoted" : "estimated"})
              </span>
            </span>
          )
        },
      },
      {
        id: "yourShare",
        accessorFn: (r) => Number(partnerShare(r)?.amount ?? 0),
        header: ({ column }) => (
          <SortableHeader column={column} title="Your share" />
        ),
        cell: ({ row }) => {
          const share = partnerShare(row.original)
          if (!share) return <span className="text-muted-foreground">—</span>
          return (
            <span className="font-medium tabular-nums">
              {formatMoney(share.amount, row.original.currency)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                ({share.fixed ? "fixed" : `${share.percent}%`})
              </span>
            </span>
          )
        },
      },
      {
        id: "project",
        header: "Delivery project",
        cell: ({ row }) => {
          const r = row.original
          return r.projectId ? (
            <Link href={`/projects/${r.projectId}`} className="font-mono link">
              {r.projectCode}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )
        },
      },
      {
        id: "expectedCloseDate",
        accessorFn: (r) => r.expectedCloseDate ?? "",
        header: ({ column }) => (
          <SortableHeader column={column} title="Expected" />
        ),
        cell: ({ row }) =>
          row.original.expectedCloseDate ? (
            <span className="text-muted-foreground">
              {formatDate(row.original.expectedCloseDate)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const r = row.original
          const pending = !r.response
          return (
            <div className="flex items-center justify-end gap-2">
              {pending ? (
                <>
                  <Button size="sm" onClick={() => accept(r)}>
                    <CheckIcon className="size-4" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeclineTarget(r)}
                  >
                    <XIcon className="size-4" />
                    Decline
                  </Button>
                </>
              ) : null}
              {canCreateProject && r.response === "accepted" && !r.projectId ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setProjectTarget(r)}
                >
                  <FolderPlusIcon className="size-4" />
                  Create project
                </Button>
              ) : null}
            </div>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canCreateProject]
  )

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        tableId="intercompany-inbound"
        cap={1000}
        filters={[
          { type: "enum", columnId: "status", title: "Status", options: Array.from(new Set(data.map((row) => row.status).filter((value): value is string => Boolean(value)))).map((value) => ({ value, label: value })) },
          { type: "enum", columnId: "response", title: "Response", options: Array.from(new Set(data.map((row) => row.response).filter((value): value is NonNullable<typeof value> => Boolean(value)))).map((value) => ({ value, label: value })) },
        ]}
        searchColumn="name"
        searchPlaceholder="Search deals…"
        emptyIcon={ArrowLeftRightIcon}
        emptyMessage="No inbound intercompany deals"
        emptyDescription="When a sibling entity marks a deal as intercompany and picks this entity as its handling partner, it appears here."
      />

      {declineTarget ? (
        <DeclineDialog
          key={declineTarget.id}
          deal={declineTarget}
          onOpenChange={(o) => !o && setDeclineTarget(null)}
        />
      ) : null}

      {projectTarget ? (
        <CreateDeliveryProjectDialog
          key={projectTarget.id}
          deal={projectTarget}
          accountOptions={accountOptions}
          onOpenChange={(o) => !o && setProjectTarget(null)}
        />
      ) : null}
    </>
  )
}
