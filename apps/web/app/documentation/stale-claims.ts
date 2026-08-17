type StaleClaim = {
  label: string
  pattern: RegExp
}

const STALE_CLAIMS: StaleClaim[] = [
  {
    label: "pending → invoiced → paid",
    pattern: /pending\s*(?:→|->)\s*invoiced\s*(?:→|->)\s*paid/i,
  },
  {
    label: "milestones to paid",
    pattern:
      /milestones?\s*(?:(?:→|->|to)\s*paid|(?:become|becomes|transition(?:s)?|move(?:s)?)\s+to\s+paid)/i,
  },
  {
    label: "all milestones paid",
    pattern: /(?:all|fully)\s+milestones?\s+(?:are\s+)?paid/i,
  },
  {
    label: "one-click invoice",
    pattern: /one-click\s+(?:draft(?:s)?\s+the\s+)?invoice/i,
  },
  {
    label: "one live invoice per milestone",
    pattern: /one\s+live\s+invoice\s+per\s+milestone/i,
  },
  {
    label: "live invoice",
    pattern: /live\s+invoice/i,
  },
  {
    label: "auto-complete project",
    pattern: /auto[- ]complete(?:s|d|ing)?\s+(?:(?:the|a|an)\s+)?project/i,
  },
  {
    label: "auto_complete_project_on_paid",
    pattern: /auto_complete_project_on_paid/i,
  },
  {
    label: "legacy milestone status enum",
    pattern: /payment_milestone_status\s*\([^)]*\b(?:pending|paid)\b/i,
  },
  {
    label: "legacy live-milestone unique index",
    pattern: /finance_docs_live_milestone_uq/i,
  },
]

const NEGATION_BEFORE =
  /\b(?:no|not|never|without|does\s+not|do\s+not|doesn't|don't)\b[^.!?;]{0,120}$/i
const NEGATION_AFTER =
  /^[^.!?;]{0,80}\b(?:not|never|unsupported|disallowed|no\s+longer)\b/i

/** Keep the whitespace normalization used by rendered documentation checks. */
export function normalizeDocumentation(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function isNegated(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 120), start)
  const after = text.slice(end, end + 80)
  return NEGATION_BEFORE.test(before) || NEGATION_AFTER.test(after)
}

/**
 * Find stale positive coupling claims while allowing accurate no/does-not
 * wording. Callers should run this against both source and rendered text:
 * JSX tags can split a phrase in source while rendered text joins it.
 */
export function findForbiddenStaleClaims(text: string): string[] {
  const normalized = normalizeDocumentation(text)
  const findings = new Set<string>()

  for (const claim of STALE_CLAIMS) {
    const flags = claim.pattern.flags.includes("g")
      ? claim.pattern.flags
      : `${claim.pattern.flags}g`
    const pattern = new RegExp(claim.pattern.source, flags)

    for (const match of normalized.matchAll(pattern)) {
      const start = match.index ?? 0
      const end = start + match[0].length
      if (!isNegated(normalized, start, end)) findings.add(claim.label)
    }
  }

  return [...findings]
}
