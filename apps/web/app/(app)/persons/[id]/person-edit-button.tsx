"use client"

import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { usePermissions } from "@/components/command-palette"
import { PERMISSIONS } from "@/lib/permissions"
import type { Option } from "@/lib/lookups"
import { PersonForm } from "../person-form"
import type { PersonRow } from "../actions"

export function PersonEditButton({
  person,
  accounts,
}: {
  person: PersonRow
  accounts: Option[]
}) {
  const router = useRouter()
  const perms = usePermissions()
  if (!perms.has(PERMISSIONS.PERSON_UPDATE)) return null
  return (
    <PersonForm
      person={person}
      accounts={accounts}
      trigger={
        <Button variant="outline" size="sm">
          <Pencil className="size-4" />
          Edit
        </Button>
      }
      onSaved={() => router.refresh()}
    />
  )
}
