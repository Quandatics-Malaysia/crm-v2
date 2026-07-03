import Link from "next/link"
import { DocsShell } from "./docs-shell"
import { DOC_GROUPS } from "./registry"

/** Docs landing — grouped index of every page. */
export default function DocumentationIndexPage() {
  return (
    <DocsShell>
      <div className="grid gap-8">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Documentation
          </h1>
          <p className="text-muted-foreground">
            How the CRM works, module by module — business flows, toggles,
            settings, versioning and the schema behind them. Press{" "}
            <kbd className="rounded border bg-muted px-1.5 font-mono text-xs">
              ⌘K
            </kbd>{" "}
            to search everything.
          </p>
        </div>
        {DOC_GROUPS.map((g) => (
          <section key={g.label} className="grid gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              {g.label}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {g.pages.map((p) => (
                <Link
                  key={p.slug}
                  href={`/documentation/${p.slug}`}
                  className="group rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <p className="font-medium group-hover:underline">
                    {p.title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {p.description}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </DocsShell>
  )
}
