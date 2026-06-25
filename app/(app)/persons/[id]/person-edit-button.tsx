"use client"

import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
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
