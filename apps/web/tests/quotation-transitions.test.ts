import { describe, expect, it } from "vitest"
import {
  assertQuotationTransition,
  quotationActionsFor,
  type QuotationPermissionSet,
} from "@/lib/quotation-transitions"

const fullPermissions: QuotationPermissionSet = {
  canUpdate: true,
  canApprove: true,
  canSend: true,
  canAccept: true,
}

describe("quotation approval state machine", () => {
  it("allows Draft to Pending Approval", () => {
    expect(() => assertQuotationTransition("draft", "pending_approval")).not.toThrow()
  })

  it("allows Pending Approval to Approved", () => {
    expect(() => assertQuotationTransition("pending_approval", "approved")).not.toThrow()
  })

  it("returns approval rejection to Draft", () => {
    expect(() => assertQuotationTransition("pending_approval", "draft")).not.toThrow()
  })

  it("allows Approved to Sent", () => {
    expect(() => assertQuotationTransition("approved", "sent")).not.toThrow()
  })

  it("forbids direct Draft to Sent", () => {
    expect(() => assertQuotationTransition("draft", "sent")).toThrow(
      "Quotation must be approved before it can be sent"
    )
  })

  it("allows explicit Approved reset to Draft", () => {
    expect(() => assertQuotationTransition("approved", "draft")).not.toThrow()
  })

  it("allows customer decisions only from Sent", () => {
    expect(() => assertQuotationTransition("sent", "accepted")).not.toThrow()
    expect(() => assertQuotationTransition("sent", "rejected")).not.toThrow()
    expect(() => assertQuotationTransition("approved", "accepted")).toThrow(
      "Only sent quotations can be accepted"
    )
    expect(() => assertQuotationTransition("draft", "rejected")).toThrow(
      "Only sent quotations can be rejected by the customer"
    )
  })

  it("never offers Funnel-changing behavior as a quotation transition", () => {
    expect(quotationActionsFor("sent", fullPermissions)).toEqual([
      "accept",
      "reject_customer",
    ])
  })

  it("filters actions by permission and keeps Approved read-only until reset", () => {
    expect(
      quotationActionsFor("approved", {
        ...fullPermissions,
        canUpdate: false,
      })
    ).toEqual(["send"])
    expect(quotationActionsFor("approved", fullPermissions)).toEqual([
      "send",
      "return_to_draft",
    ])
    expect(quotationActionsFor("draft", { ...fullPermissions, canUpdate: false })).toEqual([])
  })
})
