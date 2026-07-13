import type { Tx } from "@/db"

export type ChangeEntry = { field: string; label: string; from: string; to: string }
export type FormatCtx = { tx: Tx; record: Record<string, unknown> }
export type FieldSpec = {
  label: string
  format?: (value: unknown, c: FormatCtx) => string | Promise<string>
}
export type FieldRegistry = Record<string, FieldSpec>
export type RegistryKey =
  | "account" | "person" | "lead" | "opportunity" | "funnel" | "project" | "finance_doc"
