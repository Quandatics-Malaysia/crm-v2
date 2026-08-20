import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PpvvcEditor } from "@/components/ppvvc-editor"

describe("PpvvcEditor", () => {
  it("renders the five numbered grouped sections and completion badges", () => {
    const markup = renderToStaticMarkup(
      createElement(PpvvcEditor, {
        values: {
          pain: "A pain",
          power: null,
          vision: "A vision",
          value: null,
          control: null,
        },
        editable: true,
        onSave: async () => undefined,
      })
    )

    expect(markup).toContain("1-P: Power Sponsor (PS)")
    expect(markup).toContain("2-P: Pain (Objective)")
    expect(markup).toContain("3-V: Vision")
    expect(markup).toContain("4-V: Value")
    expect(markup).toContain("5-C: Control")
    expect(markup).toContain('aria-label="Pain (Objective): complete"')
    expect(markup).toContain('aria-label="Power Sponsor (PS): missing"')
    expect(markup).toContain('aria-label="Vision: complete"')
    expect(markup).toContain('name="ppvvc-control"')
  })
})
