import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { DownloadIcon, FileIcon } from "lucide-react"

import { formatDate, formatMoney } from "@/lib/format"
import { listIndustries } from "@/lib/lookups"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { AttachmentsPanel } from "@/components/attachments/attachments-panel"
import { listEntityTimeline } from "@/app/(app)/_shared/activity-actions"
import {
  listEntityAttachments,
  listEntityDocuments,
} from "@/app/(app)/_shared/attachment-actions"
import {
  getAccount,
  listParentOptions,
  listAccountProjects,
  listAccountQuotations,
  type AccountFunnelItem,
  type AccountProjectItem,
  type AccountQuotationItem,
  type BillingAddress,
} from "../actions"
import { AccountEditButton } from "./account-edit-button"
import { AccountContacts } from "./account-contacts"

/** Tailwind class set per stage kind. Kind drives semantics, never the label. */
function stageKindClasses(kind: string): string {
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

/** Badge variant per project status — mirrors the projects table. */
const projectStatusVariant: Record<
  AccountProjectItem["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  planning: "outline",
  active: "default",
  on_hold: "secondary",
  completed: "secondary",
  cancelled: "destructive",
}

/** Badge variant per quotation status — mirrors the quotations table. */
const quotationStatusVariant: Record<
  AccountQuotationItem["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "outline",
  sent: "secondary",
  accepted: "default",
  rejected: "destructive",
  expired: "outline",
  void: "outline",
}

/** Human-readable file size — mirrors the AttachmentsPanel formatting. */
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Badge variant per rolled-up document source. */
const documentSourceVariant: Record<
  string,
  "default" | "secondary" | "outline"
> = {
  Account: "default",
  Contact: "secondary",
  Funnel: "secondary",
  Quotation: "outline",
  Project: "outline",
  Approval: "outline",
}

function formatAddress(a: BillingAddress | null | undefined): string | null {
  if (!a) return null
  const parts = [a.line1, a.line2, a.city, a.state, a.postcode, a.country]
    .map((p) => (p ?? "").toString().trim())
    .filter(Boolean)
  return parts.length ? parts.join(", ") : null
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [data, parentOptions, industries] = await Promise.all([
    getAccount(id),
    listParentOptions(id),
    listIndustries(),
  ])

  if (!data) notFound()
  const {
    account,
    parent,
    endUserAccount,
    children,
    contacts,
    funnels,
    ownerName,
  } = data
  const isReseller = account.accountType === "reseller"

  const [activity, files, documents, accountProjects, accountQuotations] =
    await Promise.all([
      listEntityTimeline("account", id),
      listEntityAttachments("account", id),
      listEntityDocuments("account", id),
      listAccountProjects(id),
      listAccountQuotations(id),
    ])

  const address = formatAddress(account.billingAddress as BillingAddress | null)

  const detail: { label: string; value: React.ReactNode }[] = [
    { label: "Code", value: account.code ?? "—" },
    {
      label: "Type",
      value: (
        <Badge variant="outline">
          {isReseller ? "Reseller" : "Client"}
        </Badge>
      ),
    },
    ...(isReseller
      ? [
          {
            label: "End user",
            value: endUserAccount ? (
              <Link
                href={`/accounts/${endUserAccount.id}`}
                className="text-primary hover:underline"
              >
                {endUserAccount.name}
              </Link>
            ) : (
              "—"
            ),
          },
        ]
      : []),
    { label: "Industry", value: account.industry ?? "—" },
    { label: "Account manager", value: ownerName ?? "—" },
    {
      label: "Registration number",
      value: account.registrationNumber ?? "—",
    },
    {
      label: "Website",
      value: account.website ? (
        <a
          href={account.website}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          {account.website}
        </a>
      ) : (
        "—"
      ),
    },
    {
      label: "Parent account",
      value: parent ? (
        <Link
          href={`/accounts/${parent.id}`}
          className="text-primary hover:underline"
        >
          {parent.name}
        </Link>
      ) : (
        "—"
      ),
    },
    { label: "Billing address", value: address ?? "—" },
    { label: "Created", value: formatDate(account.createdAt) },
  ]

  return (
    <>
      <SiteHeader
        title={account.name}
        breadcrumbs={[
          { label: "Accounts", href: "/accounts" },
          { label: account.name },
        ]}
      />
      <PageBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {account.name}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">
                {isReseller ? "Reseller" : "Client"}
              </Badge>
              {isReseller && endUserAccount ? (
                <span>
                  End user:{" "}
                  <Link
                    href={`/accounts/${endUserAccount.id}`}
                    className="text-primary hover:underline"
                  >
                    {endUserAccount.name}
                  </Link>
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AccountEditButton
              account={account}
              parentOptions={parentOptions}
              endUserOptions={parentOptions}
              industries={industries}
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid gap-4 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {detail.map((d) => (
                    <div key={d.label} className="grid gap-1">
                      <dt className="text-xs text-muted-foreground">
                        {d.label}
                      </dt>
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
                  <Badge variant="secondary">{funnels.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {funnels.length ? (
                  <ul className="divide-y rounded-lg border">
                    {funnels.map((f: AccountFunnelItem) => (
                      <li
                        key={f.opportunityId}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <div className="flex flex-col gap-0.5">
                          <Link
                            href={`/funnel/${f.opportunityId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {f.name}
                          </Link>
                          {f.amount ? (
                            <span className="text-xs text-muted-foreground">
                              {formatMoney(f.amount, f.currency)}
                            </span>
                          ) : null}
                        </div>
                        <Badge className={cn(stageKindClasses(f.stageKind))}>
                          <span className="font-mono uppercase opacity-70">
                            {f.stageCode}
                          </span>
                          <span>{f.stageName}</span>
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No funnels for this account yet.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Projects
                  <Badge variant="secondary">{accountProjects.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {accountProjects.length ? (
                  <ul className="divide-y rounded-lg border">
                    {accountProjects.map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <div className="flex flex-col gap-0.5">
                          <Link
                            href={`/projects/${p.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {p.name}
                          </Link>
                          <span className="font-mono text-xs text-muted-foreground">
                            {p.projectCode}
                          </span>
                        </div>
                        <Badge
                          variant={projectStatusVariant[p.status] ?? "secondary"}
                        >
                          {p.status.replace(/_/g, " ")}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No projects for this account yet.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Quotations
                  <Badge variant="secondary">{accountQuotations.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {accountQuotations.length ? (
                  <ul className="divide-y rounded-lg border">
                    {accountQuotations.map((q) => (
                      <li
                        key={q.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <div className="flex flex-col gap-0.5">
                          <Link
                            href={`/quotations/${q.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {q.quoteNumber}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {formatMoney(q.total, q.currency)}
                          </span>
                        </div>
                        <Badge
                          variant={quotationStatusVariant[q.status] ?? "secondary"}
                        >
                          {q.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No quotations for this account yet.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Child accounts
                  <Badge variant="secondary">{children.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {children.length ? (
                  <ul className="divide-y rounded-lg border">
                    {children.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between px-3 py-2 text-sm"
                      >
                        <Link
                          href={`/accounts/${c.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {c.name}
                        </Link>
                        <span className="text-muted-foreground">
                          {c.accountType === "reseller" ? "Reseller" : "Client"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No child accounts.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Contacts</CardTitle>
              </CardHeader>
              <CardContent>
                <AccountContacts
                  accountId={account.id}
                  contacts={contacts}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Activity</CardTitle>
                <CardDescription>
                  Timeline across this account and its funnels.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ActivityTimeline
                  entityType="account"
                  entityId={account.id}
                  items={activity}
                  revalidate={`/accounts/${account.id}`}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Documents
                  <Badge variant="secondary">{documents.length}</Badge>
                </CardTitle>
                <CardDescription>
                  Files attached anywhere under {account.name} — its contacts,
                  funnels, quotations, and projects.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {documents.length ? (
                  <ul className="grid gap-1">
                    {documents.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                      >
                        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{d.fileName}</span>
                        <Badge
                          variant={documentSourceVariant[d.source] ?? "outline"}
                        >
                          {d.source}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {fmtBytes(d.byteSize)}
                        </span>
                        <a
                          href={`/api/files/${d.id}`}
                          className="text-muted-foreground hover:text-foreground"
                          title="Download"
                        >
                          <DownloadIcon className="size-4" />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No documents for this account yet.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Attachments</CardTitle>
                <CardDescription>
                  Files attached directly to this account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AttachmentsPanel
                  attachableType="account"
                  attachableId={account.id}
                  items={files}
                  revalidate={`/accounts/${account.id}`}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  )
}
