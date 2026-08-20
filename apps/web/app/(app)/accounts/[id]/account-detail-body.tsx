"use client"

import * as React from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { TabsContent, TabsList } from "@/components/ui/tabs"
import {
  DataTable,
  SortableHeader,
  linkCell,
  moneyCell,
  rightHeader,
} from "@/components/data-table"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { DocumentsSection } from "@/components/documents-section"
import {
  CountTab,
  DetailAside,
  DetailCardHeader,
  DetailTabs,
  FieldRow,
  FieldSection,
  RelatedCard,
  useSaveField,
} from "@/components/detail-page"
import { InlinePhoneValue, PhoneNumberDisplay } from "@/components/phone-input"
import { InlineValue } from "@/components/inline-value"
import { InlineCombobox } from "@/components/inline-combobox"
import type { MemberOption } from "@/lib/lookups"
import { StageBadge } from "@/app/(app)/funnel/stage-badge"
import { AccountContacts } from "./account-contacts"
import {
  updateAccount,
  type AccountFunnelItem,
  type AccountInput,
  type AccountOpportunityItem,
  type AccountProjectItem,
  type AccountQuotationItem,
  type BillingAddress,
  type PersonRow,
} from "../actions"

// Status pills render via the app-wide <StatusBadge> tone map.

export type AccountChild = {
  id: string
  name: string
  accountType: string | null
}

/** Structured billing-address subfields, each its own inline editor. */
export type AccountAddressKey = keyof BillingAddress

/** Raw scalar fields the page marks inline-editable (Salesforce-style). */
export type AccountEditKey =
  | "name"
  | "owner"
  | "industry"
  | "phone"
  | "website"
  | "registrationNumber"
  | "currency"
  | `address.${AccountAddressKey}`

export type AccountDetailSection = {
  title: string
  fields: { label: string; value: React.ReactNode; editKey?: AccountEditKey }[]
}

export type AccountDetailData = {
  accountId: string
  sections: AccountDetailSection[]
  /** Raw field values — updateAccount is full-replace, so each inline save
   *  merges the one edited field into this snapshot. */
  record: AccountInput
  /** Gates every inline editor (ACCOUNT_UPDATE, resolved server-side). */
  canEdit: boolean
  industries: string[]
  currencies: string[]
  /** Country picklist for the inline billing-address country combobox. */
  countries: string[]
  /** Tenant members, for the inline account-owner (account manager) picker. */
  members: MemberOption[]
  contacts: PersonRow[]
  opportunities: AccountOpportunityItem[]
  pipelines: AccountFunnelItem[]
  projects: AccountProjectItem[]
  projectsEnabled: boolean
  quotations: AccountQuotationItem[]
  childAccounts: AccountChild[]
  activity: React.ComponentProps<typeof ActivityTimeline>["items"]
  documents: React.ComponentProps<typeof DocumentsSection>["documents"]
  /** "New funnel" toolbar button (OPPORTUNITY_CREATE, resolved server-side). */
  newFunnelButton?: React.ReactNode
  /** QUOTATION_CREATE, resolved server-side — gates the empty-state CTA. */
  canCreateQuotation: boolean
  /** projects module + PROJECT_CREATE, resolved server-side. */
  canCreateProject: boolean
}

/** Salesforce-style account detail: highlights + related quick-links on the
 *  left, a tabbed panel of related lists (top 5 + search) on the right. */
export function AccountDetailBody(props: AccountDetailData) {
  const {
    accountId,
    sections,
    record,
    canEdit,
    industries,
    currencies,
    countries,
    members,
    contacts,
    opportunities,
    pipelines,
    projects,
    projectsEnabled,
    quotations,
    childAccounts,
    activity,
    documents,
    newFunnelButton,
    canCreateQuotation,
    canCreateProject,
  } = props

  // Quotations and projects are raised on a funnel, so their empty-state CTAs
  // deep-link the account's first funnel as the prefill.
  const firstFunnelId = pipelines[0]?.funnelId

  const [tab, setTab] = React.useState("contacts")
  const revalidate = `/accounts/${accountId}`


  const saveField = useSaveField((patch: Partial<AccountInput>) =>
    updateAccount(accountId, { ...record, ...patch })
  )

  const industryOptions = React.useMemo(
    () => industries.map((i) => ({ value: i, label: i })),
    [industries]
  )
  const currencyOptions = React.useMemo(
    () => currencies.map((currency) => ({ value: currency, label: currency })),
    [currencies]
  )
  const countryOptions = React.useMemo(
    () => countries.map((c) => ({ value: c, label: c })),
    [countries]
  )
  const memberOptions = React.useMemo(
    () => members.map((m) => ({ value: m.memberId, label: m.name })),
    [members]
  )
  const ownerName =
    memberOptions.find((o) => o.value === record.ownerMemberId)?.label ?? "—"

  /** Merge one edited billing-address subfield into the structured jsonb. */
  const saveAddress = (sub: AccountAddressKey, next: string) =>
    saveField({
      billingAddress: { ...record.billingAddress, [sub]: next || null },
    })

  const opportunityColumns = React.useMemo<ColumnDef<AccountOpportunityItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Opportunity" />,
        cell: linkCell((r) => `/opportunities/${r.id}`, (r) => r.name),
      },
      {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.code}
          </span>
        ),
      },
      {
        accessorKey: "funnelCount",
        header: "Funnels",
        cell: ({ row }) => (
          <Badge variant="secondary" className="tabular-nums">
            {row.original.funnelCount}
          </Badge>
        ),
      },
      {
        accessorKey: "totalEstimatedFunnelAmount",
        header: rightHeader("Value"),
        cell: moneyCell(
          (r) => r.totalEstimatedFunnelAmount,
          (r) => r.currency
        ),
      },
    ],
    []
  )

  const funnelColumns = React.useMemo<ColumnDef<AccountFunnelItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Funnel" />,
        cell: linkCell((r) => `/funnel/${r.funnelId}`, (r) => r.name),
      },
      {
        id: "stage",
        header: "Stage",
        cell: ({ row }) => (
          <StageBadge
            kind={row.original.stageKind}
            code={row.original.stageCode}
            name={row.original.stageName}
          />
        ),
      },
      {
        accessorKey: "amount",
        header: rightHeader("Value"),
        cell: moneyCell(
          (r) => r.amount,
          (r) => r.currency
        ),
      },
    ],
    []
  )

  const projectColumns = React.useMemo<ColumnDef<AccountProjectItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: linkCell((r) => `/projects/${r.id}`, (r) => r.name),
      },
      {
        accessorKey: "projectCode",
        header: "Code",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.projectCode}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    []
  )

  const quotationColumns = React.useMemo<ColumnDef<AccountQuotationItem>[]>(
    () => [
      {
        accessorKey: "quoteNumber",
        header: ({ column }) => <SortableHeader column={column} title="Quote" />,
        cell: linkCell((r) => `/quotations/${r.id}`, (r) => r.quoteNumber),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "total",
        header: rightHeader("Total"),
        cell: moneyCell(
          (r) => r.total,
          (r) => r.currency
        ),
      },
    ],
    []
  )

  const childColumns = React.useMemo<ColumnDef<AccountChild>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: linkCell((r) => `/accounts/${r.id}`, (r) => r.name),
      },
      {
        accessorKey: "accountType",
        header: "Type",
        cell: ({ row }) => (
          <Badge variant="outline">
            {row.original.accountType === "reseller" ? "Reseller" : "Client"}
          </Badge>
        ),
      },
    ],
    []
  )

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      {/* Left column — account highlights + related quick links */}
      <DetailAside>
        <Card>
          <DetailCardHeader kind="account" eyebrow="Account" />
          <CardContent className="grid gap-5 text-sm">
            {sections.map((section) => (
              <FieldSection key={section.title} title={section.title}>
                {section.fields.map((d) => {
                  const key = canEdit ? d.editKey : undefined
                  const addressSub =
                    key && key.startsWith("address.")
                      ? (key.slice("address.".length) as AccountAddressKey)
                      : null
                  // What's left after the industry/owner/address branches below.
                  const scalarKey =
                      key &&
                      !addressSub &&
                      key !== "industry" &&
                      key !== "owner" &&
                      key !== "currency"
                      ? (key as "name" | "phone" | "website" | "registrationNumber")
                      : null
                  return (
                    <FieldRow key={d.label} label={d.label}>
                      {!key ? (
                        d.label === "Phone" ? <PhoneNumberDisplay value={record.phone} compact /> : d.value
                      ) : addressSub ? (
                        addressSub === "country" ? (
                          <InlineCombobox
                            value={record.billingAddress?.country ?? ""}
                            display={record.billingAddress?.country || "—"}
                            options={countryOptions}
                            onSave={(next) => saveAddress("country", next)}
                            searchPlaceholder="Search countries…"
                            emptyMessage="No countries configured."
                            title="Click to change country"
                          />
                        ) : (
                          <InlineValue
                            value={record.billingAddress?.[addressSub] ?? ""}
                            display={record.billingAddress?.[addressSub] || "—"}
                            title={`Click to edit ${d.label.toLowerCase()}`}
                            onSave={(next) => saveAddress(addressSub, next)}
                          />
                        )
                      ) : key === "industry" ? (
                        <InlineCombobox
                          value={record.industry ?? ""}
                          display={record.industry || "—"}
                          options={industryOptions}
                          onSave={(next) => saveField({ industry: next || null })}
                          searchPlaceholder="Search industries…"
                          emptyMessage="No industries configured."
                          title="Click to change industry"
                        />
                      ) : key === "owner" ? (
                        <InlineCombobox
                          value={record.ownerMemberId ?? ""}
                          display={ownerName}
                          options={memberOptions}
                          onSave={(next) =>
                            next ? saveField({ ownerMemberId: next }) : undefined
                          }
                          searchPlaceholder="Search members…"
                          emptyMessage="No members found."
                          title="Click to change owner"
                        />
                      ) : key === "currency" ? (
                        <InlineCombobox
                          value={record.currency}
                          display={record.currency}
                          options={currencyOptions}
                          onSave={(next) => saveField({ currency: next })}
                          searchPlaceholder="Search currencies…"
                          emptyMessage="No currencies configured."
                          title="Click to change currency"
                        />
                      ) : scalarKey === "phone" ? (
                        <InlinePhoneValue
                          value={record.phone}
                          defaultCountry={record.billingAddress?.country}
                          title={`Click to edit ${d.label.toLowerCase()}`}
                          onSave={(next) => saveField({ phone: next || null })}
                        />
                      ) : scalarKey ? (
                        <InlineValue
                          value={record[scalarKey] ?? ""}
                          display={record[scalarKey] || "—"}
                          title={`Click to edit ${d.label.toLowerCase()}`}
                          onSave={(next) => {
                            // Name is required — ignore an emptied draft.
                            if (scalarKey === "name") {
                              if (!next.trim()) return
                              return saveField({ name: next })
                            }
                            return saveField({ [scalarKey]: next || null })
                          }}
                        />
                      ) : (
                        d.value
                      )}
                    </FieldRow>
                  )
                })}
              </FieldSection>
            ))}
          </CardContent>
        </Card>

        <RelatedCard
          items={[
            { kind: "contact", label: "Contacts", count: contacts.length, onSelect: () => setTab("contacts") },
            { kind: "opportunity", label: "Opportunities", count: opportunities.length, onSelect: () => setTab("opportunities") },
            { kind: "funnel", label: "Funnels", count: pipelines.length, onSelect: () => setTab("pipelines") },
            ...(projectsEnabled
              ? [{ kind: "project" as const, label: "Projects", count: projects.length, onSelect: () => setTab("projects") }]
              : []),
            { kind: "quotation", label: "Quotations", count: quotations.length, onSelect: () => setTab("quotations") },
            { kind: "account", label: "Child accounts", count: childAccounts.length, onSelect: () => setTab("children") },
          ]}
        />
      </DetailAside>

      {/* Right column — tabbed related lists */}
      <DetailTabs value={tab} onValueChange={setTab}>
        <TabsList>
          <CountTab value="contacts" count={contacts.length}>
            Contacts
          </CountTab>
          <CountTab value="opportunities" count={opportunities.length}>
            Opportunities
          </CountTab>
          <CountTab value="pipelines" count={pipelines.length}>
            Funnels
          </CountTab>
          {projectsEnabled ? (
            <CountTab value="projects" count={projects.length}>
              Projects
            </CountTab>
          ) : null}
          <CountTab value="quotations" count={quotations.length}>
            Quotations
          </CountTab>
          <CountTab value="children" count={childAccounts.length}>
            Child accounts
          </CountTab>
          <CountTab value="activity">Activity</CountTab>
          <CountTab value="documents" count={documents.length}>
            Documents
          </CountTab>
        </TabsList>

        <TabsContent value="contacts" className="mt-4">
          <AccountContacts accountId={accountId} contacts={contacts} />
        </TabsContent>

        <TabsContent value="opportunities" className="mt-4">
          <DataTable
            columns={opportunityColumns}
            data={opportunities}
            tableId="account-opportunities"
            searchColumn="name"
            searchPlaceholder="Search opportunities…"
            emptyMessage="No opportunities for this account yet."
            emptyDescription="An opportunity is created automatically when you add a funnel or convert a lead."
            pageSize={5}
          />
        </TabsContent>

        <TabsContent value="pipelines" className="mt-4">
          <DataTable
            columns={funnelColumns}
            data={pipelines}
            tableId="account-pipelines"
            searchColumn="name"
            searchPlaceholder="Search pipelines…"
            emptyMessage="No pipelines for this account yet."
            pageSize={5}
            toolbar={newFunnelButton}
          />
        </TabsContent>

        {projectsEnabled ? <TabsContent value="projects" className="mt-4">
          <DataTable
            columns={projectColumns}
            data={projects}
            tableId="account-projects"
            searchColumn="name"
            searchPlaceholder="Search projects…"
            emptyMessage="No projects for this account yet."
            emptyDescription={
              firstFunnelId
                ? "Projects are created from a funnel."
                : "Projects are created from a funnel — create a funnel for this account first."
            }
            emptyAction={
              canCreateProject && firstFunnelId ? (
                <Button
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link
                      href={`/projects?new=1&funnelId=${firstFunnelId}&accountId=${accountId}`}
                    />
                  }
                >
                  <Plus className="size-4" />
                  New project
                </Button>
              ) : undefined
            }
            pageSize={5}
          />
        </TabsContent> : null}

        <TabsContent value="quotations" className="mt-4">
          <DataTable
            columns={quotationColumns}
            data={quotations}
            tableId="account-quotations"
            searchColumn="quoteNumber"
            searchPlaceholder="Search quotations…"
            emptyMessage="No quotations for this account yet."
            emptyDescription={
              firstFunnelId
                ? "Quotations are raised on a funnel."
                : "Quotations are raised on a funnel — create a funnel for this account first."
            }
            emptyAction={
              canCreateQuotation && firstFunnelId ? (
                <Button
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link href={`/quotations/new?funnelId=${firstFunnelId}`} />
                  }
                >
                  <Plus className="size-4" />
                  New quotation
                </Button>
              ) : undefined
            }
            pageSize={5}
          />
        </TabsContent>

        <TabsContent value="children" className="mt-4">
          <DataTable
            columns={childColumns}
            data={childAccounts}
            tableId="account-children"
            searchColumn="name"
            searchPlaceholder="Search child accounts…"
            emptyMessage="No child accounts."
            pageSize={5}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <ActivityTimeline
            entityType="account"
            entityId={accountId}
            items={activity}
            revalidate={revalidate}
          />
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <DocumentsSection
            uploadType="account"
            uploadId={accountId}
            documents={documents}
            revalidate={revalidate}
          />
        </TabsContent>
      </DetailTabs>
    </div>
  )
}
