import Link from "next/link"
import { notFound } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatMoney } from "@/lib/format"
import { getOpportunity } from "../actions"

const PPVVC: { key: "pain" | "power" | "vision" | "value" | "control"; label: string }[] = [
  { key: "pain", label: "Pain" },
  { key: "power", label: "Power" },
  { key: "vision", label: "Vision" },
  { key: "value", label: "Value" },
  { key: "control", label: "Control" },
]

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const detail = await getOpportunity(id)
  if (!detail) notFound()
  const o = detail.opportunity

  return (
    <>
      <SiteHeader title={o.name} />
      <PageBody className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {o.name}
              <Badge variant="outline" className="font-mono font-normal">
                {o.code}
              </Badge>
            </CardTitle>
            <CardDescription>
              {detail.accountName} · Owner {detail.ownerName ?? "—"} · Total est.
              funnel amount{" "}
              <span className="font-medium tabular-nums">
                {formatMoney(o.totalEstimatedFunnelAmount, o.currency)}
              </span>
            </CardDescription>
          </CardHeader>
          {o.description ? (
            <CardContent className="text-sm text-muted-foreground">
              {o.description}
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Analysis (PPVVC)</CardTitle>
            <CardDescription>
              Cascades to every funnel under this opportunity.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {PPVVC.map((f) => (
              <div key={f.key}>
                <div className="text-xs font-medium text-muted-foreground">
                  {f.label}
                </div>
                <div className="text-sm">{o[f.key] || "—"}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Funnels ({detail.funnels.length})
            </CardTitle>
            <CardDescription>The deals under this opportunity.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Funnel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Est. amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.funnels.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      No funnels yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  detail.funnels.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">
                        <Link href={`/funnel/${f.id}`} className="hover:underline">
                          {f.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{f.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(f.estimatedAmount, f.currency)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageBody>
    </>
  )
}
