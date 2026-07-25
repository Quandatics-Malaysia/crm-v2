import { getSettings, getDefaultFunnel } from "@/app/(app)/settings/actions"
import { FunnelStagesClient } from "./funnel-stages-client"

export default async function FunnelStagesSettingsPage() {
  const [settings, funnel] = await Promise.all([getSettings(), getDefaultFunnel()])
  return (
    <FunnelStagesClient funnel={funnel} customFields={settings.customFunnelFields} />
  )
}
