import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/format"
import { listAccountOptions } from "@/lib/lookups"
import { listEntityTimeline } from "../../_shared/activity-actions"
import { listEntityDocuments } from "../../_shared/attachment-actions"
import { getPerson } from "../actions"
import { PersonEditButton } from "./person-edit-button"
import { PersonDetailBody } from "./person-detail-body"

function fullName(p: { firstName: string; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ")
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
  const { person, accountName, funnels, projects } = data

  const name = fullName(person) || "Unnamed contact"

  const [activity, documents] = await Promise.all([
    listEntityTimeline("person", id),
    listEntityDocuments("person", id),
  ])

  // Salesforce-named field section (SPEC §7): a single "Contact Information"
  // section grouping the contact's own fields. Only fields already fetched are
  // included.
  const contactInformation: { label: string; value: React.ReactNode }[] = [
    { label: "Title", value: person.title ?? "—" },
    {
      label: "Email",
      value: person.email ? (
        <a
          href={`mailto:${person.email}`}
          className="link"
        >
          {person.email}
        </a>
      ) : (
        "—"
      ),
    },
    { label: "Phone", value: person.phone ?? "—" },
    {
      label: "Account",
      value: person.accountId ? (
        <Link
          href={`/accounts/${person.accountId}`}
          className="link"
        >
          {accountName ?? "—"}
        </Link>
      ) : (
        "—"
      ),
    },
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

  const sections: { title: string; fields: { label: string; value: React.ReactNode }[] }[] = [
    { title: "Contact Information", fields: contactInformation },
  ]

  return (
    <>
      <SiteHeader
        title={name}
        breadcrumbs={[{ label: "Contacts", href: "/persons" }, { label: name }]}
      />
      <PageBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight">{name}</h2>
            {person.title ? (
              <p className="text-sm text-muted-foreground">{person.title}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PersonEditButton person={person} accounts={accounts} />
          </div>
        </div>

        <PersonDetailBody
          personId={id}
          sections={sections}
          funnels={funnels}
          projects={projects}
          activity={activity}
          documents={documents}
        />
      </PageBody>
    </>
  )
}
