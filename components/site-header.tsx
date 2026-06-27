import * as React from "react"
import Link from "next/link"

import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { HeaderActions } from "@/components/command-palette"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export type Crumb = { label: string; href?: string }

const DASHBOARD_ROOT: Crumb = { label: "Dashboard", href: "/dashboard" }

export function SiteHeader({
  title,
  breadcrumbs,
}: {
  title: string
  breadcrumbs?: Crumb[]
}) {
  // Always anchor breadcrumb trails at the Dashboard root so a nested detail
  // page keeps a path back home (skip when the page already starts there).
  const crumbs =
    breadcrumbs && breadcrumbs.length
      ? breadcrumbs[0]?.href === DASHBOARD_ROOT.href
        ? breadcrumbs
        : [DASHBOARD_ROOT, ...breadcrumbs]
      : breadcrumbs

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        {crumbs && crumbs.length ? (
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((c, i) => (
                <React.Fragment key={`${c.label}-${i}`}>
                  <BreadcrumbItem>
                    {c.href && i < crumbs.length - 1 ? (
                      <BreadcrumbLink render={<Link href={c.href} />}>
                        {c.label}
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{c.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {i < crumbs.length - 1 ? <BreadcrumbSeparator /> : null}
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        ) : (
          <h1 className="text-base font-medium">{title}</h1>
        )}
        <div className="ml-auto flex items-center gap-2">
          <HeaderActions />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
