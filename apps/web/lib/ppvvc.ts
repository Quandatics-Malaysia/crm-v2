export const PPVVC_FIELDS = [
  { key: "pain", number: 1, label: "Pain" },
  { key: "power", number: 2, label: "Power" },
  { key: "vision", number: 3, label: "Vision" },
  { key: "value", number: 4, label: "Value" },
  { key: "control", number: 5, label: "Control" },
] as const

export type PpvvcField = (typeof PPVVC_FIELDS)[number]["key"]
export type PpvvcValues = { [K in PpvvcField]: string | null }
export type PpvvcPatch = Partial<PpvvcValues>

export type PpvvcCompletion = (typeof PPVVC_FIELDS)[number] & {
  complete: boolean
}

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0
}

/** Convert any row-shaped PPVVC input into the complete canonical value set. */
export function normalizePpvvcValues(values: PpvvcPatch | null | undefined): PpvvcValues {
  return Object.fromEntries(
    PPVVC_FIELDS.map(({ key }) => {
      const value = values?.[key]
      return [key, present(value) ? value!.trim() : null]
    })
  ) as PpvvcValues
}

/** Read ordered completion state for badges and stage requirement UI. */
export function getPpvvcCompletion(
  values: PpvvcPatch | null | undefined
): PpvvcCompletion[] {
  return PPVVC_FIELDS.map((field) => ({
    ...field,
    complete: present(values?.[field.key]),
  }))
}

export function isPpvvcComplete(values: PpvvcPatch | null | undefined): boolean {
  return getPpvvcCompletion(values).every((field) => field.complete)
}
