import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { getForecast, getPipelineSummary } from "./actions"
import { ForecastClient } from "./forecast-client"
import { ForecastCharts } from "./forecast-charts"

export default async function ForecastPage() {
  const [rows, pipeline] = await Promise.all([
    getForecast(),
    getPipelineSummary(),
  ])

  return (
    <>
      <SiteHeader title="Forecast" />
      <PageBody>
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Billing Forecast
          </h2>
          <p className="text-sm text-muted-foreground">
            Weighted by stage probability across forecast-eligible
            funnels. Amounts are grouped by currency — figures in
            different currencies are never summed together.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Report — derived, read-only. Figures are computed from
          forecast-eligible funnels and their primary quotation; nothing
          here is editable. Stages included in the forecast are configured in
          Settings → Funnel Stages.
        </p>
        <ForecastCharts rows={rows} pipeline={pipeline} />
        <ForecastClient rows={rows} />
      </PageBody>
    </>
  )
}
