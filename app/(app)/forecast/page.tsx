import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import { getForecast } from "./actions"
import { ForecastClient } from "./forecast-client"

export default async function ForecastPage() {
  const rows = await getForecast()

  return (
    <>
      <SiteHeader title="Forecast" />
      <PageBody>
        <PageHeader
          title="Billing Forecast"
          description="Weighted by stage probability across open funnels."
        />
        <p className="text-xs text-muted-foreground">
          Report — derived, read-only. Figures are computed from open funnels and
          their primary quotation; nothing here is editable. Stages included in
          the forecast are configured in Settings → Funnel Stages.
        </p>
        <ForecastClient rows={rows} />
      </PageBody>
    </>
  )
}
