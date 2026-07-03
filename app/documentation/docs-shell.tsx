import { DocsNav } from "./docs-nav"
import { DOC_GROUPS } from "./registry"

/** Two-column docs shell: sticky grouped nav left, reading column right. */
export function DocsShell({ children }: { children: React.ReactNode }) {
  // Strip bodies before crossing to the client nav component.
  const navGroups = DOC_GROUPS.map((g) => ({
    label: g.label,
    pages: g.pages.map((p) => ({ slug: p.slug, title: p.title })),
  }))
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100svh-5.5rem)] lg:overflow-y-auto">
        <DocsNav groups={navGroups} />
      </aside>
      <div className="min-w-0 max-w-3xl">{children}</div>
    </div>
  )
}
