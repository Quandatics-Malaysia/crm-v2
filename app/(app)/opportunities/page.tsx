import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
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
import { listOpportunities } from "./actions"

export default async function OpportunitiesPage() {
  const rows = await listOpportunities()
  return (
    <>
      <SiteHeader title="Opportunities" />
      <PageBody>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Opportunity</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-center">Funnels</TableHead>
                <TableHead className="text-right">Est. funnel amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No opportunities yet. One is created automatically when you
                    add a funnel or convert a lead.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.code}
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/opportunities/${r.id}`} className="hover:underline">
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>{r.accountName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.ownerName ?? "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{r.funnelCount}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(r.totalEstimatedFunnelAmount, r.currency)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </PageBody>
    </>
  )
}
