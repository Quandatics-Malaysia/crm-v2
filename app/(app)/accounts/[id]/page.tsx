import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"

import { formatDate } from "@/lib/format"
import { listIndustries, listCountries } from "@/lib/lookups"
import { listEntityTimeline } from "@/app/(app)/_shared/activity-actions"
import { listEntityDocuments } from "@/app/(app)/_shared/attachment-actions"
import {
  getAccount,
  listParentOptions,
  listAccountOpportunities,
  listAccountProjects,
  listAccountQuotations,
  type BillingAddress,
} from "../actions"
import { AccountEditButton } from "./account-edit-button"
import { AccountDetailBody } from "./account-detail-body"

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
  const [data, parentOptions, industries, countries] = await Promise.all([
    getAccount(id),
    listParentOptions(id),
    listIndustries(),
    listCountries(),
  ])

  if (!data) notFound()
  const {
    account,
    parent,
    endUserAccount,
    children,
    contacts,
    pipelines,
    ownerName,
  } = data
  const isReseller = account.accountType === "reseller"

  const [
    activity,
    documents,
    accountOpportunities,
    accountProjects,
    accountQuotations,
  ] = await Promise.all([
    listEntityTimeline("account", id),
    listEntityDocuments("account", id),
    listAccountOpportunities(id),
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
                className="link"
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
    { label: "Office phone", value: account.phone ?? "—" },
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
          className="link"
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
          className="link"
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
                    className="link"
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
              countries={countries}
            />
          </div>
        </div>

        <AccountDetailBody
          accountId={account.id}
          fields={detail}
          contacts={contacts}
          opportunities={accountOpportunities}
          pipelines={pipelines}
          projects={accountProjects}
          quotations={accountQuotations}
          childAccounts={children}
          activity={activity}
          documents={documents}
        />
      </PageBody>
    </>
  )
}
