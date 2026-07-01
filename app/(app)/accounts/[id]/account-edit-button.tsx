"use client"

import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { usePermissions } from "@/components/command-palette"
import { PERMISSIONS } from "@/lib/permissions"
import type { Option, CountryOption } from "@/lib/lookups"
import { AccountForm } from "../account-form"
import type { AccountRow } from "../actions"

export function AccountEditButton({
  account,
  parentOptions,
  endUserOptions,
  industries,
  countries,
}: {
  account: AccountRow
  parentOptions: Option[]
  endUserOptions: Option[]
  industries: string[]
  countries: CountryOption[]
}) {
  const router = useRouter()
  const perms = usePermissions()
  if (!perms.has(PERMISSIONS.ACCOUNT_UPDATE)) return null
  return (
    <AccountForm
      account={account}
      parentOptions={parentOptions}
      endUserOptions={endUserOptions}
      industries={industries}
      countries={countries}
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
