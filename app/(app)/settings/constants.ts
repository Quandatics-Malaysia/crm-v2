/** Canonical stage codes/kinds. Kept out of the "use server" actions file
 *  (which may only export async functions). */
export const STAGE_CODES = [
  "0e",
  "1d",
  "2c",
  "3b",
  "4a",
  "won",
  "lost",
  "kiv",
] as const
export type StageCode = (typeof STAGE_CODES)[number]

export const STAGE_KINDS = ["OPEN", "WON", "LOST", "PARKED"] as const
export type StageKind = (typeof STAGE_KINDS)[number]
