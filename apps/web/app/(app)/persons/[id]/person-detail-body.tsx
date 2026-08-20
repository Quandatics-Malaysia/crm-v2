"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
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
import { PhoneNumberDisplay } from "@/components/phone-input"
import { InlineValue } from "@/components/inline-value"
import { InlineCombobox } from "@/components/inline-combobox"
import { StageBadge } from "@/app/(app)/funnel/stage-badge"
import {
  updatePerson,
  type PersonInput,
  type PersonOpportunity,
  type PersonProject,
} from "../actions"

// Status pills render via the app-wide <StatusBadge> tone map.

/** Raw scalar fields the page marks inline-editable (Salesforce-style). */
export type PersonEditKey =
  | "firstName"
  | "lastName"
  | "title"
  | "department"
  | "email"
  | "phone"
  | "accountId"
  | "isPrimary"

export type PersonDetailSection = {
  title: string
  fields: { label: string; value: React.ReactNode; editKey?: PersonEditKey }[]
}

export type PersonDetailData = {
  personId: string
  sections: PersonDetailSection[]
  /** Raw field values — updatePerson is full-replace, so each inline save
   *  merges the one edited field into this snapshot. */
  record: PersonInput
  /** Gates every inline editor (PERSON_UPDATE, resolved server-side). */
  canEdit: boolean
  /** Account picker options for the linked-account inline combobox. */
  accounts: { id: string; name: string }[]
  funnels: PersonOpportunity[]
  projects: PersonProject[]
  activity: React.ComponentProps<typeof ActivityTimeline>["items"]
  documents: React.ComponentProps<typeof DocumentsSection>["documents"]
}

/** Contact detail: a highlights + related-links panel on the left; tabbed
 *  Funnels / Projects / Activity / Documents on the right (each top-5 + search). */
export function PersonDetailBody({
  personId,
  sections,
  record,
  canEdit,
  accounts,
  funnels,
  projects,
  activity,
  documents,
}: PersonDetailData) {
  const [tab, setTab] = React.useState("pipelines")
  const revalidate = `/persons/${personId}`


  const saveField = useSaveField((patch: Partial<PersonInput>) =>
    updatePerson(personId, { ...record, ...patch })
  )

  const accountOptions = React.useMemo(
    () => accounts.map((a) => ({ value: a.id, label: a.name })),
    [accounts]
  )

  // Contacts don't own funnels/projects — those live on the linked account, so
  // the empty states point there.
  const accountLink = record.accountId ? (
    <Link href={`/accounts/${record.accountId}`} className="link text-sm">
      Go to account
    </Link>
  ) : undefined

  const funnelColumns = React.useMemo<ColumnDef<PersonOpportunity>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Funnel" />,
        cell: linkCell((r) => `/funnel/${r.id}`, (r) => r.name),
      },
      {
        id: "stage",
        header: "Stage",
        cell: ({ row }) =>
          row.original.stageName ? (
            <StageBadge
              kind={row.original.stageKind}
              name={row.original.stageName}
              probability={row.original.stageProbability}
            />
          ) : (
            "—"
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

  const projectColumns = React.useMemo<ColumnDef<PersonProject>[]>(
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

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      {/* Left column — contact highlights + related quick links */}
      <DetailAside>
        <Card>
          <DetailCardHeader kind="contact" eyebrow="Contact" />
          <CardContent className="grid gap-5 text-sm">
            {sections.map((section) => (
              <FieldSection key={section.title} title={section.title}>
                {section.fields.map((d) => {
                  const key = canEdit ? d.editKey : undefined
                  return (
                    <FieldRow key={d.label} label={d.label}>
                      {!key ? (
                        d.value
                      ) : key === "isPrimary" ? (
                        <Switch
                          checked={record.isPrimary ?? false}
                          onCheckedChange={(v) => saveField({ isPrimary: v })}
                          aria-label="Primary contact"
                        />
                      ) : key === "accountId" ? (
                        <InlineCombobox
                          value={record.accountId}
                          display={
                            accountOptions.find((o) => o.value === record.accountId)
                              ?.label ?? "—"
                          }
                          options={accountOptions}
                          onSave={(next) => saveField({ accountId: next })}
                          searchPlaceholder="Search accounts…"
                          emptyMessage="No accounts found."
                          title="Click to change account"
                        />
                      ) : (
                        <InlineValue
                          value={record[key] ?? ""}
                          display={
                            key === "phone" ? (
                              <PhoneNumberDisplay value={record[key]} compact />
                            ) : (
                              record[key] || "—"
                            )
                          }
                          title={`Click to edit ${d.label.toLowerCase()}`}
                          onSave={(next) => {
                            // First name is required — ignore an emptied draft.
                            if (key === "firstName") {
                              if (!next.trim()) return
                              return saveField({ firstName: next })
                            }
                            return saveField({ [key]: next || null })
                          }}
                        />
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
            { kind: "funnel", label: "Funnels", count: funnels.length, onSelect: () => setTab("pipelines") },
            { kind: "project", label: "Projects", count: projects.length, onSelect: () => setTab("projects") },
          ]}
        />
      </DetailAside>

      {/* Right column — tabbed related lists */}
      <DetailTabs value={tab} onValueChange={setTab}>
        <TabsList>
          <CountTab value="pipelines" count={funnels.length}>
            Funnels
          </CountTab>
          <CountTab value="projects" count={projects.length}>
            Projects
          </CountTab>
          <CountTab value="activity">Activity</CountTab>
          <CountTab value="documents" count={documents.length}>
            Documents
          </CountTab>
        </TabsList>

        <TabsContent value="pipelines" className="mt-4">
          <DataTable
            columns={funnelColumns}
            data={funnels}
            tableId="person-pipelines"
            searchColumn="name"
            searchPlaceholder="Search pipelines…"
            emptyMessage="No pipelines for this contact yet."
            emptyDescription="Funnels are created on the contact's account."
            emptyAction={accountLink}
            pageSize={5}
          />
        </TabsContent>

        <TabsContent value="projects" className="mt-4">
          <DataTable
            columns={projectColumns}
            data={projects}
            tableId="person-projects"
            searchColumn="name"
            searchPlaceholder="Search projects…"
            emptyMessage="No projects for this contact yet."
            emptyDescription="Projects are created from a funnel on the contact's account."
            emptyAction={accountLink}
            pageSize={5}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <ActivityTimeline
            entityType="person"
            entityId={personId}
            items={activity}
            revalidate={revalidate}
          />
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <DocumentsSection
            uploadType="person"
            uploadId={personId}
            documents={documents}
            revalidate={revalidate}
          />
        </TabsContent>
      </DetailTabs>
    </div>
  )
}
