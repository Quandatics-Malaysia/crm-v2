import { listApiKeys } from "./actions"
import { AccessClient } from "./access-client"

export default async function AccessSettingsPage() {
  const keys = await listApiKeys()
  return <AccessClient data={keys} />
}
