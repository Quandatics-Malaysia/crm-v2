import { describe, expect, it } from "vitest"
import {
  assertTransitionAllowed,
  canBypassApproval,
  buildStageGate,
  missingFromKeys,
  stagesEnteredBy,
  requiredKeysForStages,
  applyPpvvcToStageGate,
  requiresCloseRemarks,
  entersMilestoneAutoCreateStage,
  entersMilestoneDeleteStage,
  REQUIRABLE_FIELD_KEYS,
  type StageGateState,
} from "@/lib/stage-gate"
import { canTransition } from "@/app/(app)/funnel/stage-transitions"
import { PERMISSIONS } from "@/lib/permissions"

const stage = (id: string, kind: string, sortOrder: number) => ({
  id,
  kind,
  sortOrder,
})

describe("assertTransitionAllowed — stage state machine", () => {
  const open1 = stage("s1", "OPEN", 1)
  const open2 = stage("s2", "OPEN", 2)
  const parked = stage("p", "PARKED", 99)
  const won = stage("w", "WON", 99)
  const lost = stage("l", "LOST", 98)

  it("allows forward and backward OPEN moves plus OPEN→terminal", () => {
    expect(() => assertTransitionAllowed(open1, open2)).not.toThrow()
    expect(() => assertTransitionAllowed(open2, open1)).not.toThrow()
    expect(() => assertTransitionAllowed(open1, won)).not.toThrow()
    expect(() => assertTransitionAllowed(open1, lost)).not.toThrow()
  })

  it("rejects a no-op move to the same stage", () => {
    expect(() => assertTransitionAllowed(open1, open1)).toThrow(/already in this stage/)
  })

  it("allows reversible KIV moves but rejects immutable Won/Lost moves", () => {
    expect(() => assertTransitionAllowed(won, open2)).toThrow(/closed/)
    expect(() => assertTransitionAllowed(lost, open1)).toThrow(/closed/)
    expect(() => assertTransitionAllowed(parked, open2)).not.toThrow()
    expect(() => assertTransitionAllowed(open2, parked)).not.toThrow()
  })

  it("uses the same rule for the client transition helper", () => {
    expect(canTransition(open2, open1)).toBe(true)
    expect(canTransition(parked, open1)).toBe(true)
    expect(canTransition(open1, parked)).toBe(true)
    expect(canTransition(won, open1)).toBe(false)
    expect(canTransition(lost, open1)).toBe(false)
    expect(canTransition(open1, open1)).toBe(false)
  })
})

describe("canBypassApproval", () => {
  const ctx = (isSuperadmin: boolean, held: string[]) => ({
    isSuperadmin,
    can: (k: string) => held.includes(k),
  })

  it("superadmin bypasses regardless of permissions", () => {
    expect(canBypassApproval(ctx(true, []))).toBe(true)
  })

  it("stage-approval permission holders bypass", () => {
    expect(canBypassApproval(ctx(false, [PERMISSIONS.STAGE_ADVANCE_APPROVE]))).toBe(true)
  })

  it("everyone else is gated — even with other stage permissions", () => {
    expect(canBypassApproval(ctx(false, []))).toBe(false)
    expect(canBypassApproval(ctx(false, [PERMISSIONS.STAGE_ADVANCE]))).toBe(false)
  })
})

// All preset flags false (or true) in one object.
const presets = (v: boolean): StageGateState =>
  Object.fromEntries(
    [
      "hasEstimate", "hasCloseDate", "hasContact", "hasNature", "hasQuote",
      "hasVision", "hasPain", "hasOwnerContact", "hasOwnerBudgetLimit",
      "hasOppEstimatedBudget", "hasOppEstimatedCloseDate", "hasValue",
      "hasPowerSponsorContact", "hasPowerSponsorBudgetLimit",
      "hasProcurementStage", "hasNegotiationDone", "hasNegotiationDate",
      "hasExpectedInvoice",
    ].map((k) => [k, v])
  ) as StageGateState

describe("buildStageGate + missingFromKeys — entry requirements", () => {
  const customFields = [
    { key: "site_visit", label: "Site visit done?", type: "checkbox" as const },
    { key: "tender_ref", label: "Tender reference" },
  ]

  it("blocks on unmet presets and custom fields, with human labels", () => {
    const gate = buildStageGate(presets(false), { tender_ref: "  " }, customFields)
    const missing = missingFromKeys(["estimate", "site_visit", "tender_ref"], gate)
    expect(missing.map((m) => m.key)).toEqual(["estimate", "site_visit", "tender_ref"])
    expect(missing.find((m) => m.key === "estimate")?.label).toBe(
      "Estimated funnel amount"
    )
  })

  it("a required checkbox must be ticked, not merely present", () => {
    const gate = buildStageGate(presets(true), { site_visit: "false" }, customFields)
    expect(missingFromKeys(["site_visit"], gate).length).toBe(1)
    const ok = buildStageGate(presets(true), { site_visit: "true" }, customFields)
    expect(missingFromKeys(["site_visit"], ok)).toEqual([])
  })

  it("covers every preset key so a satisfied gate passes clean", () => {
    const gate = buildStageGate(presets(true), null, [])
    expect(missingFromKeys([...REQUIRABLE_FIELD_KEYS], gate)).toEqual([])
  })

  it("updates PPVVC-backed gate flags immediately after a successful save", () => {
    const gate = buildStageGate(presets(false), null, [])
    const live = applyPpvvcToStageGate(gate, {
      pain: "Business pain",
      power: null,
      vision: "Target state",
      value: "Measured value",
      control: null,
    })

    expect(live.satisfied).toMatchObject({
      objective: true,
      vision: true,
      value: true,
    })
    expect(live.satisfied.estimate).toBe(false)
  })
})

describe("stagesEnteredBy — a skip still collects intermediate requirements", () => {
  const ladder = [
    { id: "a", kind: "OPEN", sortOrder: 1, requiredFields: ["estimate"] },
    { id: "b", kind: "OPEN", sortOrder: 2, requiredFields: ["contact"] },
    { id: "c", kind: "OPEN", sortOrder: 3, requiredFields: ["quote", "estimate"] },
    { id: "won", kind: "WON", sortOrder: 4, requiredFields: [] },
    { id: "lost", kind: "LOST", sortOrder: 5, requiredFields: null },
  ]

  it("a→c passes through b (skipping can't dodge b's requirements)", () => {
    const entered = stagesEnteredBy(ladder, "a", "c")
    expect(entered.map((s) => s.id)).toEqual(["b", "c"])
    expect(requiredKeysForStages(entered)).toEqual(["contact", "quote", "estimate"])
  })

  it("direct Open→Won can skip PPVVC preset requirements", () => {
    const jump = [
      { id: "a", kind: "OPEN", sortOrder: 1, requiredFields: ["vision", "ownerContact"] },
      { id: "b", kind: "OPEN", sortOrder: 2, requiredFields: ["objective", "procurementStage"] },
      { id: "won", kind: "WON", sortOrder: 3, requiredFields: ["value"] },
    ]
    const entered = stagesEnteredBy(jump, "a", "won")
    expect(entered.map((s) => s.id)).toEqual(["b", "won"])
    expect(requiredKeysForStages(entered, { skipPpvvcForWonTransition: true })).toEqual([
      "procurementStage",
      "ownerContact",
    ])
  })

  it("a forward move into LOST/PARKED enters only the terminal target", () => {
    expect(stagesEnteredBy(ladder, "a", "lost").map((s) => s.id)).toEqual(["lost"])
  })

  it("a backward rollback enters no stages, so it bypasses entry requirements", () => {
    expect(stagesEnteredBy(ladder, "c", "a")).toEqual([])
    expect(requiredKeysForStages(stagesEnteredBy(ladder, "c", "a"))).toEqual([])
  })

  it("a forward move after rollback re-enters every stage and revalidates requirements", () => {
    const rollback = stagesEnteredBy(ladder, "c", "a")
    expect(rollback).toEqual([])
    const forward = stagesEnteredBy(ladder, "a", "c")
    expect(requiredKeysForStages(forward)).toEqual(["contact", "quote", "estimate"])
  })

  it("unknown stage ids yield no entered stages", () => {
    expect(stagesEnteredBy(ladder, "a", "zzz")).toEqual([])
  })
})

describe("requiresCloseRemarks", () => {
  it("only Lost and KIV need close remarks", () => {
    expect(requiresCloseRemarks("LOST")).toBe(true)
    expect(requiresCloseRemarks("PARKED")).toBe(true)
    expect(requiresCloseRemarks("WON")).toBe(false)
    expect(requiresCloseRemarks("OPEN")).toBe(false)
  })
})

describe("milestone lifecycle triggers (SF 'Project Item List' flows)", () => {
  it("entering 4A or Won triggers auto-create, regardless of stage id/name", () => {
    expect(entersMilestoneAutoCreateStage({ code: "4a", kind: "OPEN" })).toBe(true)
    expect(entersMilestoneAutoCreateStage({ code: "won", kind: "WON" })).toBe(true)
    // A funnel's `isRenewal` flag doesn't change the trigger — entering 4A/Won
    // is the whole condition, whether or not the deal is a renewal.
    expect(entersMilestoneAutoCreateStage({ code: "3b", kind: "OPEN" })).toBe(false)
  })

  it("only 4A/Won trigger auto-create — earlier open stages and terminal non-Won stages don't", () => {
    for (const code of ["0e", "1d", "2c", "3b"] as const) {
      expect(entersMilestoneAutoCreateStage({ code, kind: "OPEN" })).toBe(false)
    }
    expect(entersMilestoneAutoCreateStage({ code: "lost", kind: "LOST" })).toBe(false)
    expect(entersMilestoneAutoCreateStage({ code: "kiv", kind: "PARKED" })).toBe(false)
  })

  it("entering Lost or KIV triggers the pending-only delete", () => {
    expect(entersMilestoneDeleteStage("LOST")).toBe(true)
    expect(entersMilestoneDeleteStage("PARKED")).toBe(true)
    expect(entersMilestoneDeleteStage("WON")).toBe(false)
    expect(entersMilestoneDeleteStage("OPEN")).toBe(false)
  })
})
