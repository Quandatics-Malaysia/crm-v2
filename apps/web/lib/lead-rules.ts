import type { leads } from "@/db/schema"

export type LeadInput = {
  name: string
  companyName?: string | null
  email?: string | null
  phone?: string | null
  source?: string | null
  status?: (typeof leads)["$inferSelect"]["status"]
}

export function clean(v?: string | null): string | null {
  const t = (v ?? "").trim()
  return t.length ? t : null
}

export function normalizeLeadInput(input: LeadInput) {
  return {
    name: input.name.trim(),
    companyName: clean(input.companyName),
    email: clean(input.email),
    phone: clean(input.phone),
    source: clean(input.source),
    status: input.status,
  }
}
