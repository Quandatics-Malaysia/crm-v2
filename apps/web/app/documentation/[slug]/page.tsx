import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, ArrowRightIcon, ChevronRightIcon } from "lucide-react"
import { DocsShell } from "../docs-shell"
import { getDocPage, getDocSiblings } from "../registry"

export default async function DocumentationPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const page = getDocPage(slug)
  if (!page) notFound()
  const { prev, next } = getDocSiblings(slug)

  return (
    <DocsShell>
      <article>
        <nav className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
          <Link href="/documentation" className="hover:underline">
            Documentation
          </Link>
          <ChevronRightIcon className="size-3" />
          <span className="text-foreground">{page.title}</span>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
        <p className="mt-1 mb-6 text-muted-foreground">{page.description}</p>
        {page.body}

        {/* Prev / next footer */}
        <div className="mt-10 grid gap-3 border-t pt-6 sm:grid-cols-2">
          {prev ? (
            <Link
              href={`/documentation/${prev.slug}`}
              className="group rounded-lg border p-3 transition-colors hover:bg-accent/40"
            >
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowLeftIcon className="size-3" /> Previous
              </span>
              <span className="mt-0.5 block text-sm font-medium group-hover:underline">
                {prev.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`/documentation/${next.slug}`}
              className="group rounded-lg border p-3 text-right transition-colors hover:bg-accent/40"
            >
              <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                Next <ArrowRightIcon className="size-3" />
              </span>
              <span className="mt-0.5 block text-sm font-medium group-hover:underline">
                {next.title}
              </span>
            </Link>
          ) : null}
        </div>
      </article>
    </DocsShell>
  )
}
