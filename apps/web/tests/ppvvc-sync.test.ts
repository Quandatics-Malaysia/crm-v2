import { describe, expect, it } from "vitest"
import { CHANGE_FIELDS } from "@/server/services/changes/registry"
import {
  PPVVC_FIELDS,
  getPpvvcDirtyPatch,
  getPpvvcFieldsForRequiredKeys,
  getPpvvcCompletion,
  mergePpvvcDraft,
} from "@/lib/ppvvc"

const values = {
  pain: "No approved business case",
  power: "CFO sponsor",
  vision: "Automated renewal workflow",
  value: "Reduce processing time",
  control: "Quarterly executive review",
}

describe("PPVVC metadata", () => {
  it("keeps the exact numbered Pain, Power, Vision, Value, Control order", () => {
    expect(PPVVC_FIELDS).toEqual([
      { key: "pain", number: 1, label: "Pain" },
      { key: "power", number: 2, label: "Power" },
      { key: "vision", number: 3, label: "Vision" },
      { key: "value", number: 4, label: "Value" },
      { key: "control", number: 5, label: "Control" },
    ])
  })

  it("marks each category complete from its trimmed value", () => {
    expect(
      getPpvvcCompletion({
        pain: "  identified  ",
        power: "",
        vision: null,
        value: "0",
        control: "   ",
      })
    ).toEqual([
      { key: "pain", number: 1, label: "Pain", complete: true },
      { key: "power", number: 2, label: "Power", complete: false },
      { key: "vision", number: 3, label: "Vision", complete: false },
      { key: "value", number: 4, label: "Value", complete: true },
      { key: "control", number: 5, label: "Control", complete: false },
    ])
  })

  it("submits only fields changed from the latest server snapshot", () => {
    expect(
      getPpvvcDirtyPatch(values, {
        ...values,
        pain: "Updated pain",
        power: "  CFO sponsor  ",
      })
    ).toEqual({ pain: "Updated pain" })
  })

  it("adopts refreshed clean props without clobbering an unsaved local edit", () => {
    expect(
      mergePpvvcDraft(
        { ...values, pain: "Old pain", power: "Old power" },
        { ...values, pain: "Local pain", power: "Old power" },
        { ...values, pain: "Server pain", power: "Refreshed power" }
      )
    ).toEqual({ ...values, pain: "Local pain", power: "Refreshed power" })
  })

  it("selects only PPVVC fields represented by entered-stage requirements", () => {
    expect(
      getPpvvcFieldsForRequiredKeys([
        "vision",
        "powerSponsorContact",
        "objective",
        "control",
      ])
    ).toEqual([
      { key: "pain", number: 1, label: "Pain" },
      { key: "power", number: 2, label: "Power" },
      { key: "vision", number: 3, label: "Vision" },
    ])
  })
})

describe("PPVVC synchronization", () => {
  it("registers every PPVVC field for Funnel change history", () => {
    expect(Object.keys(CHANGE_FIELDS.funnel)).toEqual(
      expect.arrayContaining(["pain", "power", "vision", "value", "control"])
    )
  })

})
