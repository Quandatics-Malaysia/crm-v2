import { z } from "zod"

// SemVer 2.0.0's complete identifier grammar. Numeric prerelease identifiers
// cannot contain leading zeroes; build identifiers may.
export const STRICT_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export const StrictSemverSchema = z.string().max(64).regex(STRICT_SEMVER_PATTERN)

export function isStrictSemver(value: string): boolean {
  return StrictSemverSchema.safeParse(value).success
}
