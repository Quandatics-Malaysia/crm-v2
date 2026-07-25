"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowUpRightIcon, BookOpenIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { ThemeToggle } from "@/components/theme-toggle"

export type DocsSearchEntry = {
  slug: string
  title: string
  description: string
  group: string
  /** Full flattened page text — the search matches anything mentioned anywhere. */
  text: string
}

/** Standalone docs chrome: wordmark, full-text search (⌘K), theme, exit. */
export function DocsHeader({ index }: { index: DocsSearchEntry[] }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const groups = React.useMemo(() => {
    const by = new Map<string, DocsSearchEntry[]>()
    for (const e of index) {
      const list = by.get(e.group) ?? []
      list.push(e)
      by.set(e.group, list)
    }
    return [...by.entries()]
  }, [index])

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href="/documentation" className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BookOpenIcon className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">
            CRM Documentation
          </span>
          <span className="rounded-full border px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
            internal
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto flex h-9 w-full max-w-64 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-accent"
        >
          <SearchIcon className="size-4" />
          Search docs…
          <kbd className="ml-auto rounded border bg-background px-1.5 font-mono text-[0.65rem]">
            ⌘K
          </kbd>
        </button>

        <ThemeToggle />
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/dashboard" />}
        >
          Open CRM
          <ArrowUpRightIcon className="size-3.5" />
        </Button>
      </div>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command>
          <CommandInput placeholder="Search everything in the docs…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            {groups.map(([label, entries]) => (
              <CommandGroup key={label} heading={label}>
                {entries.map((e) => (
                  <CommandItem
                    key={e.slug}
                    // Full page text participates in matching, so searching any
                    // mentioned term (a setting, a table, a status) finds its page.
                    value={`${e.title} ${e.description} ${e.text}`}
                    onSelect={() => {
                      setOpen(false)
                      router.push(`/documentation/${e.slug}`)
                    }}
                  >
                    <div className="grid gap-0.5">
                      <span className="font-medium">{e.title}</span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {e.description}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </header>
  )
}
