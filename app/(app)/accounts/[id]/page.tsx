import Link from "next/link"
import { notFound } from "next/navigation"

import { Plus } from "lucide-react"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { formatDate } from "@/lib/format"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { isModuleEnabled } from "@/lib/modules"
import {
  listIndustries,
  listCountries,
  listAccountOptions,
  listMembers,
  listFunnelsWithStages,
  listCustomFunnelFields,
  listEntities,
  listCurrencies,
} from "@/lib/lookups"
import { listPersonsWithAccount } from "@/app/(app)/funnel/actions"
import { OpportunityForm } from "@/app/(app)/funnel/opportunity-form"
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
import { AccountDetailBody, type AccountDetailSection } from "./account-detail-body"

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [data, parentOptions, industries, countries, members, ctx] =
    await Promise.all([
      getAccount(id),
      listParentOptions(id),
      listIndustries(),
      listCountries(),
      listMembers(),
      requireContext(),
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

  // "New funnel" in the Funnels tab (account preset). The form's lookup data
  // is only fetched when the user can actually create one.
  const canCreateFunnel = ctx.can(PERMISSIONS.OPPORTUNITY_CREATE)
  let newFunnelButton: React.ReactNode
  if (canCreateFunnel) {
    const [accounts, persons, members, funnelDefs, customFunnelFields, entities, currencies] =
      await Promise.all([
        listAccountOptions(),
        listPersonsWithAccount(),
        listMembers(),
        listFunnelsWithStages(),
        listCustomFunnelFields(),
        listEntities(),
        listCurrencies(),
      ])
    newFunnelButton = (
      <OpportunityForm
        mode="create"
        presetAccountId={account.id}
        accounts={accounts}
        persons={persons}
        members={members}
        pipelines={funnelDefs}
        customFieldDefs={customFunnelFields}
        entityOptions={entities}
        financeEnabled={isModuleEnabled("finance")}
        currencies={currencies}
        defaultOwnerMemberId={ctx.memberId}
        trigger={
          <Button size="sm">
            <Plus className="size-4" />
            New funnel
          </Button>
        }
      />
    )
  }

// Salesforce-named field sections (SPEC §6). Account Information groups the
  // company/registration/owner fields; Address Information holds the billing
  // address. Only fields already fetched are included.
  const accountInformation: AccountDetailSection["fields"] = [
    { label: "Name", value: account.name, editKey: "name" },
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
    { label: "Industry", value: account.industry ?? "—", editKey: "industry" },
    { label: "Phone", value: account.phone ?? "—", editKey: "phone" },
    { label: "Account manager", value: ownerName ?? "—", editKey: "owner" },
    {
      label: "Registration number",
      value: account.registrationNumber ?? "—",
      editKey: "registrationNumber" as const,
    },
    {
      label: "Website",
      editKey: "website",
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
    { label: "Created", value: formatDate(account.createdAt) },
  ]

  // One inline-editable row per structured subfield (the jsonb column can't
  // round-trip a single free-text blob).
  const billing = account.billingAddress as BillingAddress | null
  const addressInformation: AccountDetailSection["fields"] = [
    { label: "Street line 1", value: billing?.line1 ?? "—", editKey: "address.line1" },
    { label: "Street line 2", value: billing?.line2 ?? "—", editKey: "address.line2" },
    { label: "City", value: billing?.city ?? "—", editKey: "address.city" },
    { label: "State", value: billing?.state ?? "—", editKey: "address.state" },
    { label: "Postcode", value: billing?.postcode ?? "—", editKey: "address.postcode" },
    { label: "Country", value: billing?.country ?? "—", editKey: "address.country" },
  ]

  const sections: AccountDetailSection[] = [
    { title: "Account Information", fields: accountInformation },
    { title: "Address Information", fields: addressInformation },
  ]

  // Raw snapshot for the inline editors — updateAccount is full-replace, so
  // the client merges the one edited field into this.
  const record = {
    name: account.name,
    code: account.code,
    parentAccountId: account.parentAccountId,
    accountType: account.accountType,
    endUserAccountId: account.endUserAccountId,
    ownerMemberId: account.ownerMemberId,
    industry: account.industry,
    website: account.website,
    phone: account.phone,
    registrationNumber: account.registrationNumber,
    billingAddress: account.billingAddress as BillingAddress | null,
  }

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
          sections={sections}
          record={record}
          canEdit={ctx.can(PERMISSIONS.ACCOUNT_UPDATE)}
          industries={industries}
          countries={countries.map((c) => c.name)}
          members={members}
          contacts={contacts}
          opportunities={accountOpportunities}
          pipelines={pipelines}
          projects={accountProjects}
          quotations={accountQuotations}
          childAccounts={children}
          activity={activity}
          documents={documents}
          newFunnelButton={newFunnelButton}
          canCreateQuotation={ctx.can(PERMISSIONS.QUOTATION_CREATE)}
          canCreateProject={
            isModuleEnabled("projects") && ctx.can(PERMISSIONS.PROJECT_CREATE)
          }
        />
      </PageBody>
    </>
  )
}
