export type QuotationTemplateLineContext = {
  sku?: string | null
  description?: string | null
  quantity?: string | number | null
  uom?: string | null
  unitPrice?: string | number | null
  lineSubtotal?: string | number | null
  lineTotal?: string | number | null
}

export type QuotationTemplateContext = {
  lines?: readonly QuotationTemplateLineContext[]
  [key: string]: unknown
}

export type RenderedQuotationTemplate = {
  html: string
  css: string
}

const TOKEN_PATTERN = /{{\s*([^{}]+?)\s*}}/g

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function displayValue(value: unknown): string {
  if (value == null) return ""
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function resolveToken(token: string, context: QuotationTemplateContext): unknown {
  const normalized = token.trim()
  if (normalized === "this") return context
  const path = normalized.startsWith("this.") ? normalized.slice(5) : normalized
  return path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object") {
      return (value as Record<string, unknown>)[key]
    }
    return undefined
  }, context)
}

function renderHtmlTokens(template: string, context: QuotationTemplateContext): string {
  return template.replace(TOKEN_PATTERN, (_match, token: string) =>
    escapeHtml(displayValue(resolveToken(token, context)))
  )
}

function renderLineBlocks(template: string, context: QuotationTemplateContext): string {
  return template.replace(
    /{{\s*#each\s+lines\s*}}([\s\S]*?){{\s*\/each\s*}}/g,
    (_match, body: string) =>
      (context.lines ?? [])
        .map((line, index) =>
          renderHtmlTokens(body, {
            ...context,
            ...line,
            "@index": index + 1,
            index: index + 1,
            this: line,
          })
        )
        .join("")
  )
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|iframe|object|embed|form|link|meta|base)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|iframe|object|embed|form|link|meta|base)\b[^>]*\/?>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\1/gi, "")
}

function sanitizeCss(css: string): string {
  return css
    .replace(/@import[\s\S]*?;/gi, "")
    .replace(/url\s*\([\s\S]*?\)/gi, "")
    .replace(/expression\s*\([\s\S]*?\)/gi, "")
    .replace(/behavior\s*:[^;{}]+;?/gi, "")
    .replace(/-moz-binding\s*:[^;{}]+;?/gi, "")
    .replace(/<\/?style\b[^>]*>/gi, "")
    .replace(/<\/style/gi, "\\3C/style")
}

export function renderQuotationTemplate({
  htmlTemplate,
  cssTemplate,
  context,
}: {
  htmlTemplate: string
  cssTemplate?: string | null
  context: QuotationTemplateContext
}): RenderedQuotationTemplate {
  const withLines = renderLineBlocks(htmlTemplate, context)
  return {
    html: sanitizeHtml(renderHtmlTokens(withLines, context)),
    css: sanitizeCss(cssTemplate ?? ""),
  }
}
