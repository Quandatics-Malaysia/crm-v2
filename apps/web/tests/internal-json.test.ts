import { describe, expect, it } from "vitest"

import {
  MAX_INTERNAL_ENTITLEMENT_BODY_BYTES,
  readInternalJsonObject,
} from "@/lib/internal-json"

function request(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("http://web:3000/api/internal/deployment/entitlement", {
    method: "PUT",
    body,
    headers,
    duplex: "half",
  } as RequestInit & { duplex: "half" })
}

async function expectError(input: Request, status: number, code: string): Promise<void> {
  await expect(readInternalJsonObject(input)).rejects.toMatchObject({
    status,
    code,
  })
}

describe("bounded internal JSON object reader", () => {
  it("accepts parameterized JSON media type and returns exact body byte count", async () => {
    const body = '{"keyId":"vendor","payload":{},"signature":"abc"}'

    await expect(readInternalJsonObject(request(body, {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(body)),
    }))).resolves.toEqual({
      value: { keyId: "vendor", payload: {}, signature: "abc" },
      bodyBytes: Buffer.byteLength(body),
    })
  })

  it.each([
    [{ "content-type": "text/json", "content-length": "2" }, 400, "invalid_request"],
    [{ "content-type": "application/json" }, 413, "payload_too_large"],
    [{ "content-type": "application/json", "content-length": "+2" }, 413, "payload_too_large"],
    [{ "content-type": "application/json", "content-length": "2.0" }, 413, "payload_too_large"],
    [{ "content-type": "application/json", "content-length": String(MAX_INTERNAL_ENTITLEMENT_BODY_BYTES + 1) }, 413, "payload_too_large"],
  ])("rejects media type or declared length before parsing %#", async (headers, status, code) => {
    await expectError(request("{}", headers), status, code)
  })

  it.each([
    '{"keyId":"one","keyId":"two"}',
    '{"payload":{"nested":1,"nested":2}}',
    "[]",
    "null",
    "{} trailing",
    '{\u00a0"x":1}',
    "",
  ])("rejects duplicate keys, non-objects, and trailing JSON: %s", async (body) => {
    await expectError(request(body, {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    }), 400, "invalid_request")
  })

  it("rejects excessive nesting depth", async () => {
    const body = `${'{"x":'.repeat(65)}0${"}".repeat(65)}`
    await expectError(request(body, {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    }), 400, "invalid_request")
  })

  it("rejects invalid UTF-8 fatally", async () => {
    const body = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d])
    await expectError(request(body, {
      "content-type": "application/json",
      "content-length": String(body.byteLength),
    }), 400, "invalid_request")
  })

  it("cancels a stream that exceeds the hard cap despite a smaller declaration", async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(MAX_INTERNAL_ENTITLEMENT_BODY_BYTES + 1))
      },
      cancel() {
        cancelled = true
      },
    })
    await expectError(request(body, {
      "content-type": "application/json",
      "content-length": "2",
    }), 413, "payload_too_large")
    expect(cancelled).toBe(true)
  })
})
