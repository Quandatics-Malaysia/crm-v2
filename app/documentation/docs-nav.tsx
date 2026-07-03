"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

/** Secondary docs sidebar (Vercel-docs-style grouped nav with active state).
 *  Receives plain data — the registry itself stays server-side. */
export function DocsNav({
  groups,
}: {
  groups: { label: string; pages: { slug: string; title: string }[] }[]
}) {
  const pathname = usePathname()
  return (
    <nav className="grid content-start gap-5 text-sm">
      {groups.map((g) => (
        <div key={g.label} className="grid gap-1">
          <p className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {g.label}
          </p>
          {g.pages.map((p) => {
            const href = `/documentation/${p.slug}`
            const active = pathname === href
            return (
              <Link
                key={p.slug}
                href={href}
                className={cn(
                  "rounded-md px-2 py-1.5 leading-5 transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                {p.title}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
