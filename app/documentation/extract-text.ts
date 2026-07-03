import * as React from "react"

/**
 * Flatten a React element tree (our doc bodies are plain data — never
 * rendered here) into searchable text. Walks children plus the DocTable
 * head/rows props; skips Mermaid chart sources (diagram syntax, not prose).
 */
export function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return `${node} `
  if (Array.isArray(node)) return node.map(extractText).join("")
  if (React.isValidElement(node)) {
    const props = node.props as {
      children?: React.ReactNode
      head?: React.ReactNode[]
      rows?: React.ReactNode[][]
    }
    let out = extractText(props.children)
    if (props.head) out += extractText(props.head)
    if (props.rows) out += extractText(props.rows)
    return out
  }
  return ""
}
