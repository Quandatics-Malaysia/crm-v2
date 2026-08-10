import assert from "node:assert/strict"
import test from "node:test"

test("plain Node imports the built control protocol package", async () => {
  const protocol = await import("@crm/control-protocol")

  assert.equal(protocol.canonicalJson({ 2: "two", 10: "ten" }), '{"10":"ten","2":"two"}')
})

test("plain Node imports the billing subpath", async () => {
  const billing = await import("@crm/control-protocol/billing")

  assert.equal(billing.countMonthlyBillingPeriods("2026-08-05", "2027-08-04"), 12)
})
