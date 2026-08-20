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
import type { ActionResult } from "@/lib/action-result"
import { cn } from "@/lib/utils"
import { useInlineSave } from "@/components/use-inline-save"

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

/** One label/value row in the highlights card. Default is stacked
 *  (small label above value); `inline` renders the 9rem two-column shape.
 *  min-w-0 lets inline editors (combobox + cancel) shrink instead of
 *  overflowing the neighboring column. */
export function FieldRow({
  label,
  inline,
  className,
  children,
}: {
  label: string
  inline?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)] items-start gap-x-4 gap-y-1",
        "max-sm:grid-cols-1 max-sm:gap-1",
        inline && "grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)]",
        className
      )}
    >
      <span className="text-sm leading-5 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-sm leading-5">{children}</span>
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
  const { save } = useInlineSave(action, { onSuccess: () => router.refresh() })
  return async (patch: TPatch) => {
    await save(patch)
  }
}
