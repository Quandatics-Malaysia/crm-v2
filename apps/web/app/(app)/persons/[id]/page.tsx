import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/format"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { listAccountOptions } from "@/lib/lookups"
import { listEntityTimeline } from "../../_shared/activity-actions"
import { listEntityDocuments } from "../../_shared/attachment-actions"
import { getPerson } from "../actions"
import { PersonEditButton } from "./person-edit-button"
import { PersonDetailBody, type PersonDetailSection } from "./person-detail-body"

function fullName(p: { firstName: string; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ")
}

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [data, accounts, ctx] = await Promise.all([
    getPerson(id),
    listAccountOptions(),
    requireContext(),
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
  const contactInformation: PersonDetailSection["fields"] = [
    { label: "First name", value: person.firstName, editKey: "firstName" },
    { label: "Last name", value: person.lastName ?? "—", editKey: "lastName" },
    { label: "Title", value: person.title ?? "—", editKey: "title" },
    {
      label: "Email",
      editKey: "email",
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
    { label: "Phone", value: person.phone ?? "—", editKey: "phone" },
    {
      label: "Account",
      editKey: "accountId",
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
      editKey: "isPrimary",
      value: person.isPrimary ? (
        <Badge variant="secondary">Primary</Badge>
      ) : (
        "—"
      ),
    },
    { label: "Created", value: formatDate(person.createdAt) },
  ]

  const sections: PersonDetailSection[] = [
    { title: "Contact Information", fields: contactInformation },
  ]

  // Raw snapshot for the inline editors — updatePerson is full-replace, so
  // the client merges the one edited field into this.
  const record = {
    accountId: person.accountId,
    firstName: person.firstName,
    lastName: person.lastName,
    title: person.title,
    email: person.email,
    phone: person.phone,
    isPrimary: person.isPrimary,
  }

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
          record={record}
          canEdit={ctx.can(PERMISSIONS.PERSON_UPDATE)}
          accounts={accounts}
          funnels={funnels}
          projects={projects}
          activity={activity}
          documents={documents}
        />
      </PageBody>
    </>
  )
}
