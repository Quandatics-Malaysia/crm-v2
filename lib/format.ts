export function formatMoney(
  value: string | number | null | undefined,
  currency = "MYR"
): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0)
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: currency || "MYR",
  }).format(Number.isFinite(n) ? (n as number) : 0)
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—"
  const date = typeof d === "string" ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium" }).format(date)
}

export function formatPercent(p: string | number | null | undefined): string {
  const n = typeof p === "string" ? Number(p) : (p ?? 0)
  return `${Number.isFinite(n) ? n : 0}%`
}
