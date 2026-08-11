/**
 * JSON encoding for signed protocol payloads. It accepts only JSON data and
 * applies a stable recursive object-key ordering before serializing.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value)
}

function serialize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value)
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers")
    }
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    const values: string[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError("Canonical JSON does not support sparse arrays")
      }
      values.push(serialize(value[index]))
    }
    return `[${values.join(",")}]`
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON supports plain objects only")
    }

    const object = value as Record<string, unknown>
    const entries = Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serialize(object[key])}`)
    return `{${entries.join(",")}}`
  }

  throw new TypeError(`Canonical JSON does not support ${typeof value} values`)
}
