import { redirect } from "next/navigation"

export default function TaxSettingsRedirect() {
  redirect("/settings/billing/tax")
}
