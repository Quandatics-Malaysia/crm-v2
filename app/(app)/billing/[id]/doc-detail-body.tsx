"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { BellRingIcon, PlusIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { showActionError } from "@/lib/show-action-error"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusBadge } from "@/components/status-badge"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { DocumentsSection } from "@/components/documents-section"
import { formatDate, formatMoney } from "@/lib/format"
import { reminderStageDue, daysOverdue } from "@/lib/reminders"
import { FINANCE_KINDS, type FinanceDocKind } from "@/lib/finance-kinds"
import {
  logReminder,
  setFinanceDocStatus,
  type FinanceDocDetail,
  type FinanceDocStatus,
} from "../actions"
import { CreateDocDialog } from "../finance-docs-table"

const EMPTY_SOURCES = { salesOrders: [], docs: [], milestones: [] }

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-baseline gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

export function DocDetailBody({
  detail,
  activity,
  documents,
  canManage,
}: {
  detail: FinanceDocDetail
  activity: React.ComponentProps<typeof ActivityTimeline>["items"]
  documents: React.ComponentProps<typeof DocumentsSection>["documents"]
  canManage: boolean
}) {
  const router = useRouter()
  const { doc } = detail
  const meta = FINANCE_KINDS[doc.kind as FinanceDocKind]
  const revalidate = `/billing/${doc.id}`
  const needsProof =
    (doc.kind === "receipt" || doc.kind === "payment") && doc.status === "draft"
  const overdue = doc.status === "issued" ? daysOverdue(doc.dueDate, new Date()) : 0
  const stageDue = reminderStageDue(doc.dueDate, detail.reminderSchedule, new Date())
  const reminderPending = doc.status === "issued" && stageDue > doc.reminderStage

  const [busy, setBusy] = React.useState(false)

  async function move(next: FinanceDocStatus) {
    setBusy(true)
    try {
      const res = await setFinanceDocStatus(doc.id, next)
      if (!res.ok) {
        showActionError(res)
        return
      }
      toast.success(`${doc.number} ${next}`)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function remind() {
    const res = await logReminder(doc.id)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Reminder logged")
    router.refresh()
  }

  const childKinds = (Object.keys(FINANCE_KINDS) as FinanceDocKind[]).filter(
    (k) => FINANCE_KINDS[k].parents.includes(doc.kind as FinanceDocKind)
  )
  const [childKind, setChildKind] = React.useState<FinanceDocKind | null>(null)
  const [tab, setTab] = React.useState("documents")

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      {/* Left: facts + actions */}
      <div className="grid h-fit gap-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="font-mono">{doc.number}</CardTitle>
            <StatusBadge status={doc.status} />
          </CardHeader>
          <CardContent className="grid gap-2.5">
            <Field label="Type">
              <Badge variant="outline">{meta.label}</Badge>
            </Field>
            <Field label="Amount">
              <span className="font-semibold tabular-nums">
                {formatMoney(doc.amount, doc.currency)}
              </span>
            </Field>
            <Field label={meta.direction === "sale" ? "Customer" : "Supplier"}>
              {doc.partyName ?? "—"}
            </Field>
            <Field label="Date">{doc.docDate ? formatDate(doc.docDate) : "—"}</Field>
            <Field label="Due">
              {doc.dueDate ? (
                <span className="inline-flex items-center gap-2">
                  {formatDate(doc.dueDate)}
                  {overdue > 0 ? (
                    <Badge variant="destructive">{overdue}d overdue</Badge>
                  ) : null}
                </span>
              ) : (
                "—"
              )}
            </Field>
            {doc.status === "issued" || doc.reminderStage > 0 ? (
              <Field label="Reminders">
                <span className="inline-flex items-center gap-2">
                  {doc.reminderStage > 0
                    ? `${doc.reminderStage} logged${doc.lastReminderAt ? ` · last ${formatDate(doc.lastReminderAt)}` : ""}`
                    : "None yet"}
                  {reminderPending ? (
                    <Badge variant="secondary">
                      Reminder {doc.reminderStage + 1} due
                    </Badge>
                  ) : null}
                </span>
              </Field>
            ) : null}

            <Separator />

            <Field label="Project">
              {doc.projectId ? (
                <Link href={`/projects/${doc.projectId}`} className="link">
                  {detail.projectName ?? doc.projectCode ?? "Project"}
                </Link>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Sales order">{doc.soNumber ?? "—"}</Field>
            {detail.quoteNumber ? (
              <Field label="Quotation">{detail.quoteNumber}</Field>
            ) : null}
            {detail.milestoneTitle ? (
              <Field label="Milestone">{detail.milestoneTitle}</Field>
            ) : null}
            {doc.intercompanyDealId ? (
              <Field label="Intercompany">
                <span className="inline-flex items-center gap-1.5">
                  <Badge variant="outline">Auto-mirrored</Badge>
                  {detail.counterpartNumber ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      ↔ {detail.counterpartNumber}
                    </span>
                  ) : null}
                </span>
              </Field>
            ) : null}
            {doc.notes ? (
              <>
                <Separator />
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {doc.notes}
                </p>
              </>
            ) : null}
          </CardContent>
        </Card>

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {doc.status === "draft" ? (
                <>
                  <Button
                    onClick={() => move("issued")}
                    disabled={busy || (needsProof && doc.attachCount === 0)}
                    title={
                      needsProof && doc.attachCount === 0
                        ? "Attach the payment proof first (Documents tab)"
                        : undefined
                    }
                  >
                    Issue
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => move("cancelled")}>
                    Cancel
                  </Button>
                </>
              ) : null}
              {doc.status === "issued" ? (
                <>
                  <Button variant="outline" disabled={busy} onClick={remind}>
                    <BellRingIcon className="size-4" />
                    Log reminder {doc.reminderStage + 1}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => move("settled")}>
                    Mark settled
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => move("cancelled")}>
                    Cancel
                  </Button>
                </>
              ) : null}
              {needsProof && doc.attachCount === 0 ? (
                <p className="w-full text-xs text-amber-600 dark:text-amber-400">
                  Attach the payment proof (Documents tab) to enable Issue.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {/* Chain */}
        <Card>
          <CardHeader>
            <CardTitle>Document chain</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {detail.parent ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  From {FINANCE_KINDS[detail.parent.kind].label.toLowerCase()}
                </span>
                <Link href={`/billing/${detail.parent.id}`} className="font-mono link">
                  {detail.parent.number}
                </Link>
              </div>
            ) : doc.soNumber ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">From sales order</span>
                <span className="font-mono">{doc.soNumber}</span>
              </div>
            ) : (
              <p className="text-muted-foreground">Chain root.</p>
            )}
            {detail.children.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  {FINANCE_KINDS[c.kind].label}
                </span>
                <span className="inline-flex items-center gap-2">
                  <Link href={`/billing/${c.id}`} className="font-mono link">
                    {c.number}
                  </Link>
                  <StatusBadge status={c.status} />
                </span>
              </div>
            ))}
            {canManage && doc.status === "issued" && childKinds.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {childKinds.map((k) => (
                  <Button
                    key={k}
                    size="sm"
                    variant="outline"
                    onClick={() => setChildKind(k)}
                  >
                    <PlusIcon className="size-4" />
                    {FINANCE_KINDS[k].label}
                  </Button>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {childKind ? (
          <CreateDocDialog
            key={childKind}
            direction={FINANCE_KINDS[childKind].direction}
            sources={EMPTY_SOURCES}
            preset={{ kind: childKind, parent: doc }}
            onOpenChange={(o) => !o && setChildKind(null)}
          />
        ) : null}
      </div>

      {/* Right: documents + activity */}
      <div className="lg:col-span-2">
        <Card>
          <CardContent className="min-h-[26rem] pt-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="documents">
                  Documents{doc.attachCount ? ` (${doc.attachCount})` : ""}
                </TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
              <TabsContent value="documents" className="mt-4">
                <DocumentsSection
                  uploadType="finance_doc"
                  uploadId={doc.id}
                  documents={documents}
                  revalidate={revalidate}
                />
              </TabsContent>
              <TabsContent value="activity" className="mt-4">
                <ActivityTimeline
                  entityType="finance_doc"
                  entityId={doc.id}
                  items={activity}
                  revalidate={revalidate}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
