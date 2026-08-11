import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default async function SubscriptionSettingsPage() {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold">Subscription</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Commercial access is managed by your vendor. This client workspace is read-only for
          licensing operations.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Vendor-managed entitlement</CardTitle>
          <CardDescription>
            Contact your Quandatics operator to adjust seats, payment status, modules, or suspension.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
