import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { getForecast, getPipelineSummary, getForecastConfig } from "./actions"
import { ForecastView } from "./forecast-client"

export default async function ForecastPage() {
  const [rows, pipeline, config] = await Promise.all([
    getForecast(),
    getPipelineSummary(),
    getForecastConfig(),
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
        <ForecastView
          rows={rows}
          pipeline={pipeline}
          fiscalYearStartMonth={config.fiscalYearStartMonth}
        />
      </PageBody>
    </>
  )
}
