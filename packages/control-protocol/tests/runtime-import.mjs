import assert from "node:assert/strict"
import test from "node:test"

test("plain Node imports the built control protocol package", async () => {
  const protocol = await import("@crm/control-protocol")

  assert.equal(protocol.canonicalJson({ 2: "two", 10: "ten" }), '{"10":"ten","2":"two"}')
  assert.equal(protocol.isStrictSemver("1.2.3-alpha.1+build.5"), true)
  assert.equal(protocol.isStrictSemver("1.2.3-01"), false)
})

test("plain Node imports the billing subpath", async () => {
  const billing = await import("@crm/control-protocol/billing")

  assert.equal(billing.countMonthlyBillingPeriods("2026-08-05", "2027-08-04"), 12)
})

test("plain Node imports deployment authentication helpers", async () => {
  const deploymentAuth = await import("@crm/control-protocol/deployment-auth")

  assert.equal(
    deploymentAuth.lowercaseHex(await deploymentAuth.sha256(new TextEncoder().encode("abc"))),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  )
})
