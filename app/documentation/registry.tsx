import * as React from "react"
import { overviewPage } from "./content-overview"
import {
  crmCorePage,
  funnelForecastPage,
  leadToCashPage,
  projectsPage,
  quotationsPage,
} from "./content-sales"
import { financePage, intercompanyPage } from "./content-finance"
import {
  accessControlPage,
  changelogPage,
  operationsPage,
  schemaReferencePage,
  settingsReferencePage,
} from "./content-reference"

export type DocPage = {
  slug: string
  title: string
  /** One-liner shown on the index cards and under the page title. */
  description: string
  body: React.ReactNode
}

export type DocGroup = { label: string; pages: DocPage[] }

/** The whole documentation tree — nav, index and routing all derive from it. */
export const DOC_GROUPS: DocGroup[] = [
  { label: "Getting started", pages: [overviewPage, leadToCashPage] },
  {
    label: "Modules",
    pages: [crmCorePage, funnelForecastPage, quotationsPage, projectsPage],
  },
  { label: "Finance add-on", pages: [financePage, intercompanyPage] },
  {
    label: "Reference",
    pages: [
      accessControlPage,
      settingsReferencePage,
      schemaReferencePage,
      operationsPage,
      changelogPage,
    ],
  },
]

const FLAT = DOC_GROUPS.flatMap((g) => g.pages)

export function getDocPage(slug: string): DocPage | undefined {
  return FLAT.find((p) => p.slug === slug)
}

/** Prev/next within the flattened tree (Vercel-docs-style footer links). */
export function getDocSiblings(slug: string): {
  prev: DocPage | null
  next: DocPage | null
} {
  const i = FLAT.findIndex((p) => p.slug === slug)
  return {
    prev: i > 0 ? FLAT[i - 1] : null,
    next: i >= 0 && i < FLAT.length - 1 ? FLAT[i + 1] : null,
  }
}
