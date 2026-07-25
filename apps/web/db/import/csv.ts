/**
 * Dependency-free CSV parser (RFC-4180: quoted fields, embedded commas / quotes
 * / newlines, BOM). Salesforce exports are well-formed CSV, so this is enough —
 * and keeps the "fully owned, no external dependency" posture.
 */
export type ParsedCsv = {
  headers: string[]
  rows: Record<string, string>[]
}

export function parseCsv(input: string): ParsedCsv {
  const s = input.replace(/^﻿/, "")
  const table: string[][] = []
  let field = ""
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n") {
      row.push(field)
      table.push(row)
      row = []
      field = ""
    } else if (c !== "\r") {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    table.push(row)
  }
  if (table.length === 0) return { headers: [], rows: [] }

  const headers = table[0].map((h) => h.trim())
  const rows = table
    .slice(1)
    .filter((r) => r.some((v) => v !== ""))
    .map((r) => {
      const o: Record<string, string> = {}
      headers.forEach((h, i) => {
        o[h] = (r[i] ?? "").trim()
      })
      return o
    })
  return { headers, rows }
}
