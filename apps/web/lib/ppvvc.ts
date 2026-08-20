export const PPVVC_FIELDS = [
  { key: "power", number: 1, label: "Power Sponsor (PS)" },
  { key: "pain", number: 2, label: "Pain (Objective)" },
  { key: "vision", number: 3, label: "Vision" },
  { key: "value", number: 4, label: "Value" },
  { key: "control", number: 5, label: "Control" },
] as const

const PPVVC_SECTION_CODES: Record<(typeof PPVVC_FIELDS)[number]["key"], string> = {
  power: "P",
  pain: "P",
  vision: "V",
  value: "V",
  control: "C",
}

export type PpvvcField = (typeof PPVVC_FIELDS)[number]["key"]
export type PpvvcValues = { [K in PpvvcField]: string | null }
export type PpvvcPatch = Partial<PpvvcValues>

/** Salesforce-style section heading used consistently across PPVVC surfaces. */
export function formatPpvvcSectionLabel(
  field: (typeof PPVVC_FIELDS)[number]
): string {
  return `${field.number}-${PPVVC_SECTION_CODES[field.key]}: ${field.label}`
}

export type PpvvcCompletion = (typeof PPVVC_FIELDS)[number] & {
  complete: boolean
}

const PPVVC_FIELD_BY_REQUIRED_KEY: Record<string, PpvvcField> = {
  objective: "pain",
  powerSponsorContact: "power",
  powerSponsorBudgetLimit: "power",
  value: "value",
  vision: "vision",
  control: "control",
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

/** Normalize only submitted PPVVC keys; omitted keys stay omitted. */
export function normalizePpvvcPatch(
  values: PpvvcPatch | null | undefined
): PpvvcPatch {
  return Object.fromEntries(
    PPVVC_FIELDS.filter(({ key }) => values?.[key] !== undefined).map(({ key }) => {
      const value = values?.[key]
      return [key, present(value) ? value!.trim() : null]
    })
  ) as PpvvcPatch
}

/** Return only fields that differ from the server snapshot. */
export function getPpvvcDirtyPatch(
  serverValues: PpvvcPatch | null | undefined,
  draftValues: PpvvcPatch | null | undefined
): PpvvcPatch {
  const server = normalizePpvvcValues(serverValues)
  const draft = normalizePpvvcValues(draftValues)
  return Object.fromEntries(
    PPVVC_FIELDS.filter(({ key }) => server[key] !== draft[key]).map(({ key }) => [
      key,
      draft[key],
    ])
  ) as PpvvcPatch
}

/** Merge refreshed server values while retaining fields changed locally. */
export function mergePpvvcDraft(
  previousServerValues: PpvvcPatch | null | undefined,
  draftValues: PpvvcPatch | null | undefined,
  refreshedServerValues: PpvvcPatch | null | undefined
): PpvvcValues {
  return normalizePpvvcValues({
    ...normalizePpvvcValues(refreshedServerValues),
    ...getPpvvcDirtyPatch(previousServerValues, draftValues),
  })
}

/** PPVVC sections represented by the entered stages' preset requirements. */
export function getPpvvcFieldsForRequiredKeys(
  requiredKeys: readonly string[]
): (typeof PPVVC_FIELDS)[number][] {
  const relevant = new Set(
    requiredKeys
      .map((key) => PPVVC_FIELD_BY_REQUIRED_KEY[key])
      .filter((key): key is PpvvcField => key !== undefined)
  )
  return PPVVC_FIELDS.filter((field) => relevant.has(field.key))
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
