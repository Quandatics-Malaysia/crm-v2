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
  isRollbackTransition,
  transitionDirection,
  REQUIRABLE_FIELD_KEYS,
  type StageGateState,
} from "@/lib/stage-gate"
import {
  canTransition,
  stagePathActionLabel,
  stagePathInstruction,
} from "@/app/(app)/funnel/stage-transitions"
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

  it("classifies ordinary rollback by order but PARKED transitions by status", () => {
    expect(isRollbackTransition(open2, open1)).toBe(true)
    expect(isRollbackTransition(parked, open1)).toBe(true)
    expect(isRollbackTransition(open2, parked)).toBe(false)
    expect(isRollbackTransition(open2, won)).toBe(false)
    expect(isRollbackTransition(parked, won)).toBe(false)
    expect(isRollbackTransition(open2, lost)).toBe(false)
    expect(isRollbackTransition(won, open1)).toBe(false)

    const parkedBeforeLadder = stage("parked-before", "PARKED", -100)
    const openAfterParked = stage("open-after", "OPEN", 100)
    expect(transitionDirection(open2, parkedBeforeLadder)).toBe("forward")
    expect(isRollbackTransition(open2, parkedBeforeLadder)).toBe(false)
    expect(transitionDirection(parkedBeforeLadder, openAfterParked)).toBe("rollback")
    expect(isRollbackTransition(parkedBeforeLadder, openAfterParked)).toBe(true)
    expect(transitionDirection(parkedBeforeLadder, won)).toBe("forward")
  })

  it("uses the same classifier for StagePath labels and hints", () => {
    expect(stagePathActionLabel({ ...open2, name: "Qualified" }, { ...open1, name: "Prospect" }))
      .toBe("Move back to Prospect")
    expect(stagePathActionLabel({ ...open1, name: "Prospect" }, { ...open2, name: "Qualified" }))
      .toBe("Advance to Qualified")

    const parkedBeforeLadder = { ...stage("parked-before", "PARKED", -100), name: "KIV" }
    const openAfterParked = { ...stage("open-after", "OPEN", 100), name: "Reopened" }
    const lostBeforeLadder = { ...stage("lost-before", "LOST", -200), name: "Lost" }
    expect(stagePathActionLabel({ ...open2, name: "Qualified" }, parkedBeforeLadder))
      .toBe("Advance to KIV")
    expect(stagePathActionLabel(parkedBeforeLadder, openAfterParked))
      .toBe("Move back to Reopened")
    expect(stagePathActionLabel({ ...open2, name: "Qualified" }, lostBeforeLadder))
      .toBe("Advance to Lost")
    expect(stagePathInstruction({ ...open2, name: "Qualified" }, [parkedBeforeLadder]))
      .toBe("Click a stage to Advance.")
    expect(stagePathInstruction(parkedBeforeLadder, [openAfterParked]))
      .toBe("Click a stage to Move back.")
    expect(stagePathInstruction({ ...open2, name: "Qualified" }, [{ ...open1, name: "Prospect" }, parkedBeforeLadder]))
      .toBe("Click a stage to Move back or Advance.")
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
      "hasPowerSponsorContact", "hasPowerSponsorBudgetLimit", "hasControl",
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
    // power and control remain false when null
    expect(live.satisfied.powerSponsorContact).toBe(false)
    expect(live.satisfied.powerSponsorBudgetLimit).toBe(false)
    expect(live.satisfied.control).toBe(false)
    expect(live.satisfied.estimate).toBe(false)
  })

  it("satisfies powerSponsorContact + powerSponsorBudgetLimit when power is filled", () => {
    const gate = buildStageGate(presets(false), null, [])
    const live = applyPpvvcToStageGate(gate, {
      pain: null,
      power: "Budget holder with authority",
      vision: null,
      value: null,
      control: null,
    })
    expect(live.satisfied.powerSponsorContact).toBe(true)
    expect(live.satisfied.powerSponsorBudgetLimit).toBe(true)
  })

  it("satisfies control when control field is filled", () => {
    const gate = buildStageGate(presets(false), null, [])
    const live = applyPpvvcToStageGate(gate, {
      pain: null,
      power: null,
      vision: null,
      value: null,
      control: "Mitigation plan in place",
    })
    expect(live.satisfied.control).toBe(true)
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

  it("leaving PARKED enters no stages even when its sort order is first", () => {
    const parked = { id: "parked", kind: "PARKED", sortOrder: -1, requiredFields: ["closeDate"] }
    const reopened = { id: "reopened", kind: "OPEN", sortOrder: 9, requiredFields: ["estimate"] }
    expect(stagesEnteredBy([parked, reopened], parked.id, reopened.id)).toEqual([])
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

})
