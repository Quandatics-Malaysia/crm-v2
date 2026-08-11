import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import type { SubscriptionEntitlementView } from "./actions"

const MODE_LABELS: Record<SubscriptionEntitlementView["mode"], string> = {
  active: "Active",
  grace: "Offline grace",
  read_only: "Read-only",
}

function exactInstant(value: string | null): React.ReactNode {
  return value ? <time dateTime={value}>{value}</time> : "Unavailable"
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 rounded-lg border p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="break-words text-sm font-medium">{children}</dd>
    </div>
  )
}

export function SubscriptionClient({ data }: { data: SubscriptionEntitlementView }) {
  const modeVariant = data.mode === "read_only" ? "destructive" : "secondary"
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold">Deployment entitlement</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only vendor-issued commercial details. Billing, seats, contract
          dates, and modules are managed by Quandatics.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>Commercial access</CardTitle>
            <Badge variant={modeVariant}>{MODE_LABELS[data.mode]}</Badge>
          </div>
          <CardDescription>{data.reason}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Subscription status">
              {data.subscriptionStatus ?? "Unavailable"}
            </Detail>
            <Detail label="Plan">{data.planId ?? "Unavailable"}</Detail>
            <Detail label="Seat ceiling">{data.seatLimit || "Unavailable"}</Detail>
            <Detail label="Contract starts">
              {exactInstant(data.contractStartsAt)}
            </Detail>
            <Detail label="Contract ends">
              {exactInstant(data.contractEndsAt)}
            </Detail>
            <Detail label="Lease refresh due">
              {exactInstant(data.leaseExpiresAt)}
            </Detail>
            {data.recoveryDeadline ? (
              <Detail label="Recovery deadline">
                {exactInstant(data.recoveryDeadline)}
              </Detail>
            ) : null}
            <Detail label="Entitlement revision">
              {data.revision ?? "Unavailable"}
            </Detail>
            <Detail label="Configuration version">
              {data.configurationVersion ?? "Unavailable"}
            </Detail>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enabled modules</CardTitle>
          <CardDescription>
            Module ownership follows signed deployment entitlement.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {data.moduleIds.length ? (
            data.moduleIds.map((moduleId) => (
              <Badge key={moduleId} variant="outline">{moduleId}</Badge>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No optional modules enabled.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
