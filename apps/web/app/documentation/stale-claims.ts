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

const NEGATION =
  /\b(?:no|not|never|without|does\s+not|do\s+not|doesn't|don't|unsupported|disallowed|no\s+longer)\b/i
const CLAUSE_BOUNDARY = /[,.;!?]|\b(?:but|however|although|though|yet|and|or|nor|because|while|whereas|instead)\b/gi

const JSX_TAG = /<\/?(?:[A-Za-z][A-Za-z0-9:._-]*)(?:\s[^<>]*)?\/?\s*>|<\/?\s*>/g
const JSX_STRING_EXPRESSION = /\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*\}/g

/**
 * Normalize both rendered prose and raw TSX source. JSX tags and static
 * whitespace/string expressions are presentation boundaries, not words;
 * replacing them with spaces lets a stale phrase remain detectable without
 * treating tag attributes or arbitrary expression code as documentation.
 */
export function normalizeDocumentation(text: string): string {
  return text
    .replace(JSX_STRING_EXPRESSION, (_match, doubleQuoted, singleQuoted, template) =>
      ` ${doubleQuoted ?? singleQuoted ?? template ?? ""} `
    )
    .replace(JSX_TAG, " ")
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isNegated(text: string, start: number, end: number): boolean {
  const before = text.slice(0, start)
  const after = text.slice(end)
  let clauseStart = 0
  let boundary: RegExpExecArray | null

  CLAUSE_BOUNDARY.lastIndex = 0
  while ((boundary = CLAUSE_BOUNDARY.exec(before)) !== null) {
    clauseStart = boundary.index + boundary[0].length
  }

  CLAUSE_BOUNDARY.lastIndex = 0
  const nextBoundary = CLAUSE_BOUNDARY.exec(after)
  const clauseEnd = nextBoundary?.index ?? after.length
  const clause = `${text.slice(clauseStart, start)} ${after.slice(0, clauseEnd)}`

  return NEGATION.test(clause)
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
