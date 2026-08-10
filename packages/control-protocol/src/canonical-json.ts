/**
 * JSON encoding for signed protocol payloads. It accepts only JSON data and
 * applies a stable recursive object-key ordering before serializing.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): null | boolean | number | string | CanonicalValue[] | CanonicalObject {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers")
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON supports plain objects only")
    }

    const result: CanonicalObject = Object.create(null) as CanonicalObject
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return result
  }

  throw new TypeError(`Canonical JSON does not support ${typeof value} values`)
}

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | CanonicalObject
type CanonicalObject = { [key: string]: CanonicalValue }
