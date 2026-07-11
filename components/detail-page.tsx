"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsTrigger } from "@/components/ui/tabs"
import {
  ObjectTile,
  RelatedQuickLinks,
  type ObjectKind,
  type QuickLink,
} from "@/components/object-tile"
import { showActionError } from "@/lib/show-action-error"
import type { ActionResult } from "@/lib/action-result"
import { cn } from "@/lib/utils"

/**
 * Shared building blocks for the Salesforce-style record detail template
 * (sticky highlights column on the left, tabbed related lists on the right).
 * Every *-detail-body composes these instead of hand-copying the shell.
 */

/** Sticky left column of a record detail page. */
export function DetailAside({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "grid h-fit gap-4 lg:sticky lg:top-4 lg:self-start",
        className
      )}
    >
      {children}
    </div>
  )
}

/** ObjectTile header of the highlights card ("Account / Details"). */
export function DetailCardHeader({
  kind,
  eyebrow,
  title = "Details",
}: {
  kind: ObjectKind
  eyebrow: string
  title?: string
}) {
  return (
    <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
      <ObjectTile kind={kind} />
      <div className="grid">
        <span className="text-xs text-muted-foreground">{eyebrow}</span>
        <CardTitle className="text-base">{title}</CardTitle>
      </div>
    </CardHeader>
  )
}

/** "Related" quick-links card for the left column. */
export function RelatedCard({ items }: { items: QuickLink[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Related</CardTitle>
      </CardHeader>
      <CardContent>
        <RelatedQuickLinks items={items} />
      </CardContent>
    </Card>
  )
}

/** The Card>CardContent>Tabs shell of the right column (no grid placement). */
export function TabsCard({
  value,
  onValueChange,
  children,
}: {
  value: string
  onValueChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="min-h-[26rem] pt-6">
        <Tabs value={value} onValueChange={onValueChange}>
          {children}
        </Tabs>
      </CardContent>
    </Card>
  )
}

/** TabsCard placed as the standard two-thirds right column. */
export function DetailTabs(props: React.ComponentProps<typeof TabsCard>) {
  return (
    <div className="lg:col-span-2">
      <TabsCard {...props} />
    </div>
  )
}

/** Tab trigger with the standard count badge (badge omitted when no count). */
export function CountTab({
  value,
  count,
  children,
}: {
  value: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <TabsTrigger value={value}>
      {children}
      {count != null ? (
        <Badge variant="secondary" className="ml-1.5">
          {count}
        </Badge>
      ) : null}
    </TabsTrigger>
  )
}

/** One label/value row in the highlights card. */
export function FieldRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

/** Titled group of FieldRows ("Account Information", "Address Information"). */
export function FieldSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

/** Inline-edit save handler: run the update action, toast on failure
 *  (with the permission-denial contact), refresh on success. */
export function useSaveField<TPatch>(
  action: (patch: TPatch) => Promise<ActionResult<unknown>>
) {
  const router = useRouter()
  // Deliberately not memoized: `action` closes over the caller's latest
  // `record` snapshot, and a stale memo would merge outdated fields.
  return async (patch: TPatch) => {
    const res = await action(patch)
    if (!res.ok) {
      showActionError(res)
      return
    }
    router.refresh()
  }
}
