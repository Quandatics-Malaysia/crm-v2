import { readdirSync, readFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

type CallSite = {
  file: string
  line: number
  source: string
  tableId: string | null
  optOut: boolean
}

const appDirectory = fileURLToPath(new URL("../app/", import.meta.url))

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && path.endsWith(".tsx") ? [path] : []
  })
}

function openingTagEnd(source: string, start: number): number {
  let braceDepth = 0
  let quote: '"' | "'" | "`" | null = null

  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === "\\") index += 1
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character
    } else if (character === "{") {
      braceDepth += 1
    } else if (character === "}") {
      braceDepth -= 1
    } else if (character === ">" && braceDepth === 0) {
      return index + 1
    }
  }

  return -1
}

function callSites(): CallSite[] {
  return sourceFiles(appDirectory).flatMap((file) => {
    const source = readFileSync(file, "utf8")
    return [...source.matchAll(/<DataTable\b/g)].map((match) => {
      const start = match.index ?? 0
      const end = openingTagEnd(source, start)
      const openingTag = source.slice(start, end)
      const line = source.slice(0, start).split("\n").length
      const tableId =
        openingTag.match(/\btableId\s*=\s*"([^"]+)"/)?.[1] ??
        openingTag.match(/\btableId\s*=\s*\{`([^`]+)`\}/)?.[1] ??
        (openingTag.match(/\btableId\s*=/) ? "<dynamic>" : null)
      return {
        file: relative(appDirectory, file),
        line,
        source: openingTag,
        tableId,
        optOut: /\bsavedViews\s*=\s*\{\s*false\s*\}/.test(openingTag),
      }
    })
  })
}

describe("shared DataTable call-site inventory", () => {
  it("names every application table for saved views or declares an explicit opt-out", () => {
    const sites = callSites()
    const missing = sites
      .filter((site) => site.tableId === null && !site.optOut)
      .map((site) => `${site.file}:${site.line}`)

    expect(sites).toHaveLength(40)
    expect(missing).toEqual([])
  })

  it("does not reuse a static saved-view list key across call sites", () => {
    const ids = callSites()
      .map((site) => site.tableId)
      .filter((id): id is string => id !== null && id !== "<dynamic>")
    expect(new Set(ids).size).toBe(ids.length)
  })
})
