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
const CLAUSE_BOUNDARY =
  /[,.;!?]|\b(?:but|however|although|though|yet|whereas|instead)\b/gi

const JSX_TAG = /<\/?(?:[A-Za-z][A-Za-z0-9:._-]*)(?:\s[^<>]*)?\/?\s*>|<\/?\s*>/g

function readJsxExpressionEnd(text: string, start: number): number {
  let depth = 1
  let quote: '"' | "'" | "`" | null = null

  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index]

    if (quote) {
      if (character === "\\") {
        index += 1
      } else if (character === quote) {
        quote = null
      }
      continue
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character
    } else if (character === "{") {
      depth += 1
    } else if (character === "}" && --depth === 0) {
      return index
    }
  }

  return -1
}

function parseStaticStringLiteral(expression: string): string | null {
  const literal = expression.trim()
  const quote = literal[0]

  if (
    literal.length < 2 ||
    (quote !== '"' && quote !== "'" && quote !== "`") ||
    literal[literal.length - 1] !== quote
  ) {
    return null
  }

  const content = literal.slice(1, -1)
  if (quote === "`" && content.includes("${")) return null

  // Preserve only literals that need no JavaScript evaluation. Escaped
  // literals are left out unless JSON can safely decode a double-quoted one.
  if (quote === '"') {
    try {
      return JSON.parse(literal) as string
    } catch {
      return null
    }
  }

  return content.includes("\\") ? null : content
}

function extractStaticObjectArrayStrings(expression: string): string[] | null {
  const literal = expression.trim()
  if (!literal.startsWith("[") && !literal.startsWith("{")) return null

  const containers = [literal[0]]
  const strings: string[] = []

  for (let index = 1; index < literal.length; index += 1) {
    const character = literal[index]

    if (character === "/" && literal[index + 1] === "/") {
      const newline = literal.indexOf("\n", index + 2)
      index = newline === -1 ? literal.length : newline
      continue
    }
    if (character === "/" && literal[index + 1] === "*") {
      const commentEnd = literal.indexOf("*/", index + 2)
      index = commentEnd === -1 ? literal.length : commentEnd + 1
      continue
    }

    if (character === '"' || character === "'" || character === "`") {
      let end = index + 1
      let escaped = false
      for (; end < literal.length; end += 1) {
        const next = literal[end]
        if (escaped) {
          escaped = false
        } else if (next === "\\") {
          escaped = true
        } else if (next === character) {
          break
        }
      }

      if (containers.at(-1) === "[" || containers.at(-1) === "{") {
        const value = parseStaticStringLiteral(literal.slice(index, end + 1))
        if (value !== null) strings.push(value)
      }
      index = end
      continue
    }

    if (character === "[" || character === "{" || character === "(") {
      containers.push(character)
    } else if (character === "]" || character === "}" || character === ")") {
      containers.pop()
    }
  }

  return strings
}

function extractStaticJsxAttributeLiterals(tag: string): string[] {
  const strings: string[] = []
  for (let index = 0; index < tag.length; index += 1) {
    if (tag[index] !== "{") continue
    const end = readJsxExpressionEnd(tag, index)
    if (end === -1) continue
    const expression = tag.slice(index + 1, end)
    const literal = parseStaticStringLiteral(expression)
    const objectArrayStrings = extractStaticObjectArrayStrings(expression)
    if (literal !== null) strings.push(literal)
    else if (objectArrayStrings !== null) strings.push(...objectArrayStrings)
    index = end
  }
  return strings
}

function stripDynamicJsxExpressions(text: string): string {
  let output = ""
  let index = 0

  while (index < text.length) {
    if (text[index] !== "{") {
      output += text[index]
      index += 1
      continue
    }

    const end = readJsxExpressionEnd(text, index)
    if (end === -1) {
      output += " "
      break
    }

    const expression = text.slice(index + 1, end)
    const literal = parseStaticStringLiteral(expression)
    const objectArrayStrings = extractStaticObjectArrayStrings(expression)
    if (literal !== null) {
      output += ` ${literal} `
    } else if (objectArrayStrings !== null) {
      output += objectArrayStrings.length ? ` ${objectArrayStrings.join(" ")} ` : " "
    } else {
      output += " "
    }
    index = end + 1
  }

  return output
}

/**
 * Normalize both rendered prose and raw TSX source. JSX tags and static
 * whitespace/string expressions are presentation boundaries, not words;
 * replacing them with spaces lets a stale phrase remain detectable without
 * treating tag attributes or arbitrary expression code as documentation.
 */
export function normalizeDocumentation(text: string): string {
  return stripDynamicJsxExpressions(
    text.replace(JSX_TAG, (tag) => {
      const literals = extractStaticJsxAttributeLiterals(tag)
      return literals.length ? ` ${literals.join(" ")} ` : " "
    })
  )
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
