import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatDate, formatMoney, formatPercent } from "@/lib/format"
import { listAccountOptions } from "@/lib/lookups"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { AttachmentsPanel } from "@/components/attachments/attachments-panel"
import { listActivities } from "../../_shared/activity-actions"
import { listEntityAttachments } from "../../_shared/attachment-actions"
import { getPerson } from "../actions"
import { PersonEditButton } from "./person-edit-button"

function fullName(p: { firstName: string; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ")
}

/** Inline stage badge — stage colour by kind (kind drives semantics). */
function stageKindClasses(kind: string | null): string {
  switch (kind) {
    case "WON":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
    case "LOST":
      return "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
    case "PARKED":
      return "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
    default:
      return "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
  }
}

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [data, accounts] = await Promise.all([
    getPerson(id),
    listAccountOptions(),
  ])

  if (!data) notFound()
  const { person, accountName, opportunities } = data

  const [activity, files] = await Promise.all([
    listActivities("person", id),
    listEntityAttachments("person", id),
  ])

  const name = fullName(person) || "Unnamed contact"
  const revalidate = `/persons/${id}`

  const detail: { label: string; value: React.ReactNode }[] = [
    {
      label: "Account",
      value: person.accountId ? (
        <Link
          href={`/accounts/${person.accountId}`}
          className="text-primary hover:underline"
        >
          {accountName ?? "—"}
        </Link>
      ) : (
        "—"
      ),
    },
    { label: "Title", value: person.title ?? "—" },
    {
      label: "Email",
      value: person.email ? (
        <a
          href={`mailto:${person.email}`}
          className="text-primary hover:underline"
        >
          {person.email}
        </a>
      ) : (
        "—"
      ),
    },
    { label: "Phone", value: person.phone ?? "—" },
    {
      label: "Primary",
      value: person.isPrimary ? (
        <Badge variant="secondary">Primary</Badge>
      ) : (
        "—"
      ),
    },
    { label: "Created", value: formatDate(person.createdAt) },
  ]

  return (
    <>
      <SiteHeader title="Contact" />
      <PageBody>
        <PageHeader title={name} description={person.title ?? "Contact details"}>
          <PersonEditButton person={person} accounts={accounts} />
        </PageHeader>

        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
            <CardDescription>Key details for this contact.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {detail.map((d) => (
                <div key={d.label} className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">{d.label}</dt>
                  <dd className="text-sm">{d.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Funnels
              <Badge variant="secondary">{opportunities.length}</Badge>
            </CardTitle>
            <CardDescription>
              Opportunities where {name} is the primary contact.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {opportunities.length ? (
              <ul className="divide-y rounded-lg border">
                {opportunities.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <Link
                      href={`/funnel/${o.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {o.name}
                    </Link>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">
                        {o.amount
                          ? formatMoney(o.amount, o.currency)
                          : "—"}
                      </span>
                      {o.stageName ? (
                        <Badge
                          className={cn(stageKindClasses(o.stageKind))}
                        >
                          <span>{o.stageName}</span>
                          {o.stageProbability != null ? (
                            <span className="opacity-70">
                              · {formatPercent(o.stageProbability)}
                            </span>
                          ) : null}
                        </Badge>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No opportunities for this contact yet.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <ActivityTimeline
            entityType="person"
            entityId={id}
            items={activity}
            revalidate={revalidate}
          />
          <AttachmentsPanel
            attachableType="person"
            attachableId={id}
            items={files}
            revalidate={revalidate}
          />
        </div>
      </PageBody>
    </>
  )
}
