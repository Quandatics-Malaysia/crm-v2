import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { requireEntitledRoute } from "@/lib/module-guard"
import { getForecast, getPipelineSummary, getForecastConfig } from "./actions"
import { getBilledMargin } from "@/app/(app)/billing/actions"
import { formatMoney } from "@/lib/format"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ForecastView } from "./forecast-client"

export default async function ForecastPage() {
  await requireEntitledRoute("forecast")
  const [rows, pipeline, config, billedMargin] = await Promise.all([
    getForecast(),
    getPipelineSummary(),
    getForecastConfig(),
    // Empty when the finance module is off.
    getBilledMargin().catch(() => []),
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
            pipelines. Amounts are grouped by currency — figures in
            different currencies are never summed together.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Report — derived, read-only. Figures are computed from
          forecast-eligible pipelines and their primary quotation; nothing
          here is editable. Stages included in the forecast are configured in
          Settings → Funnel Stages.
        </p>
        {billedMargin.length > 0 ? (
          <Card>
            <CardHeader>
              <CardDescription>
                Billed margin — issued invoices minus credit notes and
                purchase invoices (actuals, not forecast)
              </CardDescription>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {billedMargin.map((m) => (
                  <div key={m.currency}>
                    <CardDescription>{m.currency}</CardDescription>
                    <CardTitle className="text-2xl tabular-nums">
                      {formatMoney(m.margin, m.currency)}
                    </CardTitle>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {formatMoney(m.revenue, m.currency)} billed ·{" "}
                      {formatMoney(m.cost, m.currency)} cost
                      {Number(m.creditNotes) > 0
                        ? ` · −${formatMoney(m.creditNotes, m.currency)} credit notes`
                        : ""}
                    </p>
                  </div>
                ))}
              </div>
            </CardHeader>
          </Card>
        ) : null}

        <ForecastView
          rows={rows}
          pipeline={pipeline}
          fiscalYearStartMonth={config.fiscalYearStartMonth}
        />
      </PageBody>
    </>
  )
}
