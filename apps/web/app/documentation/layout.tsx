import { redirect } from "next/navigation"
import { requireContext } from "@/lib/server-context"
import { requireEntitledRoute } from "@/lib/module-guard"
import { PERMISSIONS } from "@/lib/permissions"
import { DOC_GROUPS } from "./registry"
import { extractText } from "./extract-text"
import { DocsHeader, type DocsSearchEntry } from "./docs-header"

/**
 * STANDALONE documentation site — outside the (app) shell on purpose: no CRM
 * sidebar, its own chrome, reached by URL only (no nav link anywhere).
 *
 * Access gate, both required:
 *   1. the member's `docs.view` permission (Owner/Admin by default —
 *      grant per role in Team & roles when someone else needs it)
 *   2. the signed deployment entitlement for `documentation`
 */
export default async function DocumentationLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireEntitledRoute("documentation")
  const ctx = await requireContext()
  if (!ctx.can(PERMISSIONS.DOCS_VIEW)) redirect("/dashboard")

  // Full-text search index, built server-side from the page trees.
  const index: DocsSearchEntry[] = DOC_GROUPS.flatMap((g) =>
    g.pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      description: p.description,
      group: g.label,
      text: extractText(p.body).replace(/\s+/g, " ").slice(0, 6000),
    }))
  )

  return (
    <div className="min-h-svh bg-background">
      <DocsHeader index={index} />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  )
}
