import { formatMoney, formatDate } from "@/lib/format"
import type { FieldSpec } from "./types"
import type { Tx } from "@/db"

type Fmt = NonNullable<FieldSpec["format"]>

export function money(currencyField = "currency"): Fmt {
  return (v, c) => formatMoney(v as string, (c.record[currencyField] as string) ?? "MYR")
}
export function date(): Fmt {
  return (v) => formatDate(v as string)
}
export function enumLabel(map: Record<string, string>): Fmt {
  return (v) => (v == null ? "—" : (map[String(v)] ?? String(v)))
}
/** loader(tx, id) → display name (or null). Resolves at capture time. */
export function fk(loader: (tx: Tx, id: string) => Promise<string | null>): Fmt {
  return async (v, c) => (v == null ? "—" : (await loader(c.tx, String(v))) ?? String(v))
}
