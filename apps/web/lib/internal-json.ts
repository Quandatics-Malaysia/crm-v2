import "server-only"

export const MAX_INTERNAL_ENTITLEMENT_BODY_BYTES = 131_072
const MAX_JSON_DEPTH = 64

export class InternalJsonRequestError extends Error {
  constructor(
    public readonly status: 400 | 413,
    public readonly code: "invalid_request" | "payload_too_large",
  ) {
    super(code)
  }
}

class StrictJsonParser {
  private offset = 0

  constructor(private readonly input: string) {}

  parseObject(): Record<string, unknown> {
    this.whitespace()
    const value = this.value(0)
    this.whitespace()
    if (this.offset !== this.input.length || value === null || Array.isArray(value) || typeof value !== "object") {
      throw new SyntaxError("Expected exactly one JSON object")
    }
    return value as Record<string, unknown>
  }

  private value(depth: number): unknown {
    if (depth > MAX_JSON_DEPTH) throw new SyntaxError("JSON nesting is too deep")
    this.whitespace()
    const token = this.input[this.offset]
    if (token === "{") return this.object(depth + 1)
    if (token === "[") return this.array(depth + 1)
    if (token === '"') return this.string()
    if (token === "t") return this.literal("true", true)
    if (token === "f") return this.literal("false", false)
    if (token === "n") return this.literal("null", null)
    return this.number()
  }

  private object(depth: number): Record<string, unknown> {
    this.offset += 1
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    this.whitespace()
    if (this.input[this.offset] === "}") {
      this.offset += 1
      return result
    }
    while (true) {
      this.whitespace()
      if (this.input[this.offset] !== '"') throw new SyntaxError("Expected object key")
      const key = this.string()
      if (Object.hasOwn(result, key)) throw new SyntaxError("Duplicate object key")
      this.whitespace()
      if (this.input[this.offset] !== ":") throw new SyntaxError("Expected colon")
      this.offset += 1
      result[key] = this.value(depth)
      this.whitespace()
      const separator = this.input[this.offset]
      this.offset += 1
      if (separator === "}") return result
      if (separator !== ",") throw new SyntaxError("Expected object separator")
    }
  }

  private array(depth: number): unknown[] {
    this.offset += 1
    const result: unknown[] = []
    this.whitespace()
    if (this.input[this.offset] === "]") {
      this.offset += 1
      return result
    }
    while (true) {
      result.push(this.value(depth))
      this.whitespace()
      const separator = this.input[this.offset]
      this.offset += 1
      if (separator === "]") return result
      if (separator !== ",") throw new SyntaxError("Expected array separator")
    }
  }

  private string(): string {
    const start = this.offset
    this.offset += 1
    while (this.offset < this.input.length) {
      const character = this.input[this.offset]
      if (character === '"') {
        this.offset += 1
        return JSON.parse(this.input.slice(start, this.offset)) as string
      }
      if (character === "\\") {
        this.offset += 2
      } else {
        if (character !== undefined && character.charCodeAt(0) < 0x20) throw new SyntaxError("Invalid string")
        this.offset += 1
      }
    }
    throw new SyntaxError("Unterminated string")
  }

  private number(): number {
    const match = this.input.slice(this.offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)
    if (!match) throw new SyntaxError("Invalid JSON value")
    this.offset += match[0].length
    const value = Number(match[0])
    if (!Number.isFinite(value)) throw new SyntaxError("Invalid JSON number")
    return value
  }

  private literal<T>(source: string, value: T): T {
    if (!this.input.startsWith(source, this.offset)) throw new SyntaxError("Invalid JSON literal")
    this.offset += source.length
    return value
  }

  private whitespace(): void {
    while (/[\u0009\u000a\u000d\u0020]/.test(this.input[this.offset] ?? "")) this.offset += 1
  }
}

export async function readInternalJsonObject(request: Request): Promise<{
  value: Record<string, unknown>
  bodyBytes: number
}> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType !== "application/json") throw new InternalJsonRequestError(400, "invalid_request")

  const declaredLength = request.headers.get("content-length")
  if (declaredLength === null || !/^\d+$/.test(declaredLength)) {
    throw new InternalJsonRequestError(413, "payload_too_large")
  }
  const expectedBytes = Number(declaredLength)
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes > MAX_INTERNAL_ENTITLEMENT_BODY_BYTES) {
    throw new InternalJsonRequestError(413, "payload_too_large")
  }

  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let bodyBytes = 0
  if (reader !== undefined) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bodyBytes += value.byteLength
      if (bodyBytes > MAX_INTERNAL_ENTITLEMENT_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new InternalJsonRequestError(413, "payload_too_large")
      }
      chunks.push(value)
    }
  }
  if (bodyBytes !== expectedBytes) throw new InternalJsonRequestError(400, "invalid_request")

  const bytes = new Uint8Array(bodyBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let decoded: string
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return { value: new StrictJsonParser(decoded).parseObject(), bodyBytes }
  } catch {
    throw new InternalJsonRequestError(400, "invalid_request")
  }
}
