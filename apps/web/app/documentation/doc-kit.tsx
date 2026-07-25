import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Typography primitives for /documentation — one place defines the docs look
 * (Vercel-docs-inspired: quiet headings, readable body, bordered tables and
 * callouts). Content files compose ONLY these, so restyling is one file.
 */

export function H2({ children }: { children: React.ReactNode }) {
  const id = slugify(children)
  return (
    <h2
      id={id}
      className="mt-10 mb-3 scroll-m-20 border-b pb-2 text-lg font-semibold tracking-tight first:mt-0"
    >
      <a href={`#${id}`} className="hover:underline">
        {children}
      </a>
    </h2>
  )
}

export function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-6 mb-2 text-base font-semibold tracking-tight">
      {children}
    </h3>
  )
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="my-3 text-sm leading-7">{children}</p>
}

export function Lead({ children }: { children: React.ReactNode }) {
  return <p className="my-3 text-base text-muted-foreground">{children}</p>
}

export function Ul({ children }: { children: React.ReactNode }) {
  return (
    <ul className="my-3 ml-5 grid list-disc gap-1.5 text-sm leading-6">
      {children}
    </ul>
  )
}

export function Ol({ children }: { children: React.ReactNode }) {
  return (
    <ol className="my-3 ml-5 grid list-decimal gap-1.5 text-sm leading-6">
      {children}
    </ol>
  )
}

export function Li({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>
}

export function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem]">
      {children}
    </code>
  )
}

export function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="my-4 overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-5">
      {children}
    </pre>
  )
}

export function Callout({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn"
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "my-4 rounded-lg border p-3 text-sm leading-6",
        tone === "warn"
          ? "border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
          : "border-sky-300/60 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10"
      )}
    >
      {children}
    </div>
  )
}

export function DocTable({
  head,
  rows,
}: {
  head: string[]
  rows: React.ReactNode[][]
}) {
  return (
    <div className="my-4 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b align-top last:border-0">
              {cells.map((c, j) => (
                <td key={j} className="px-3 py-2 leading-6">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function slugify(children: React.ReactNode): string {
  return String(
    Array.isArray(children) ? children.join(" ") : (children ?? "")
  )
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}
