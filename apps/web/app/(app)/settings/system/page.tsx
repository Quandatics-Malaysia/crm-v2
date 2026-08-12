import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getReleaseMetadata } from "@/lib/release-metadata"

export const dynamic = "force-dynamic"

export default function SystemVersionPage() {
  const release = getReleaseMetadata()
  const rows = [
    ["Application", release.releaseTag],
    ["Channel", release.releaseChannel],
    ["Environment", release.deploymentEnvironment],
    ["Image", release.imageDigestShort],
    ["Migration", release.migrationVersion],
    ["Deployed", new Date(release.deployedAt).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })],
  ]
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>System version</CardTitle>
        <Badge variant={release.releaseChannel === "stable" ? "default" : "secondary"}>
          {release.releaseChannel}
        </Badge>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="border-b pb-3 last:border-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-mono text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
