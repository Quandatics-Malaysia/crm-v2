"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"
import { SETTINGS_NAV } from "./_nav"

/**
 * Settings sub-nav. Filters items by the viewer's permissions the same way
 * `components/app-sidebar.tsx` does — build a `Set` from the passed permission
 * keys and keep an item when it has no `permission` or the set holds it. This is
 * visibility only; each section page keeps its own server-side gate.
 *
 * Styling mirrors the sidebar primitives (sidebar-accent tokens) so it reads as
 * native chrome; `usePathname` drives the active-item highlight.
 */
export function SettingsNav({
  permissions,
  isSuperadmin,
}: {
  permissions: string[]
  isSuperadmin: boolean
}) {
  const pathname = usePathname()
  const perms = React.useMemo(() => new Set(permissions), [permissions])

  const groups = SETTINGS_NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (i) =>
        (!i.superadminOnly || isSuperadmin) &&
        (!i.permission || perms.has(i.permission))
    ),
  })).filter((group) => group.items.length > 0)

  return (
    <nav
      aria-label="Settings sections"
      className="lg:w-56 lg:shrink-0"
    >
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <p className="px-2 text-xs font-medium text-muted-foreground">
              {group.label}
            </p>
            {group.items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/")
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-[6px] px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}
