"use client"

import * as React from "react"
import Link from "next/link"
import {
  TargetIcon,
  Building2Icon,
  UsersIcon,
  BriefcaseIcon,
  FilterIcon,
  FileTextIcon,
  PackageIcon,
  FolderKanbanIcon,
  ReceiptIcon,
  CreditCardIcon,
  PaperclipIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

/** The CRM objects that get a Salesforce-style coloured tile. Colours match the
 *  sidebar nav so an object reads the same everywhere it appears. */
export type ObjectKind =
  | "lead"
  | "account"
  | "contact"
  | "opportunity"
  | "funnel"
  | "quotation"
  | "product"
  | "project"
  | "salesOrder"
  | "milestone"
  | "document"

export const OBJECT_TILES: Record<
  ObjectKind,
  { label: string; color: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  lead: { label: "Lead", color: "bg-teal-500", Icon: TargetIcon },
  account: { label: "Account", color: "bg-orange-500", Icon: Building2Icon },
  contact: { label: "Contact", color: "bg-violet-500", Icon: UsersIcon },
  opportunity: { label: "Opportunity", color: "bg-amber-600", Icon: BriefcaseIcon },
  funnel: { label: "Funnel", color: "bg-amber-500", Icon: FilterIcon },
  quotation: { label: "Quotation", color: "bg-green-600", Icon: FileTextIcon },
  product: { label: "Product", color: "bg-sky-500", Icon: PackageIcon },
  project: { label: "Project", color: "bg-indigo-500", Icon: FolderKanbanIcon },
  salesOrder: { label: "Sales order", color: "bg-pink-600", Icon: ReceiptIcon },
  milestone: { label: "Payment milestone", color: "bg-yellow-600", Icon: CreditCardIcon },
  document: { label: "Document", color: "bg-slate-500", Icon: PaperclipIcon },
}

/** Salesforce-style object glyph: a white icon on a saturated rounded square. */
export function ObjectTile({
  kind,
  className,
  iconClassName,
}: {
  kind: ObjectKind
  className?: string
  iconClassName?: string
}) {
  const t = OBJECT_TILES[kind]
  const Icon = t.Icon
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-[6px] text-white",
        t.color,
        className
      )}
      aria-hidden
    >
      <Icon className={cn("size-5", iconClassName)} />
    </span>
  )
}

export type QuickLink = {
  kind: ObjectKind
  label: string
  /** Count badge shown after the label (omit for a plain record link). */
  count?: number
  /** Navigate to a record. Takes precedence over onSelect. */
  href?: string
  /** Switch to the matching tab (these mirror the right-hand related lists). */
  onSelect?: () => void
}

/** The "Related List Quick Links" card Salesforce shows in the left column — a
 *  mini object tile + name (+ count) that either jumps to a related tab
 *  (onSelect) or links straight to a record (href). */
export function RelatedQuickLinks({ items }: { items: QuickLink[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {items.map((it) => {
        const t = OBJECT_TILES[it.kind]
        const inner = (
          <>
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-[4px] text-white",
                t.color
              )}
              aria-hidden
            >
              <t.Icon className="size-3" />
            </span>
            <span className="truncate text-sm link">{it.label}</span>
            {it.count != null ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                ({it.count})
              </span>
            ) : null}
          </>
        )
        const className = "flex min-w-0 items-center gap-2 text-left"
        return it.href ? (
          <Link key={it.label} href={it.href} className={className}>
            {inner}
          </Link>
        ) : (
          <button
            key={it.label}
            type="button"
            onClick={it.onSelect}
            className={className}
          >
            {inner}
          </button>
        )
      })}
    </div>
  )
}
