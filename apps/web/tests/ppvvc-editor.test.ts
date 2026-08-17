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

    expect(markup).toContain("1-Pain")
    expect(markup).toContain("2-Power")
    expect(markup).toContain("3-Vision")
    expect(markup).toContain("4-Value")
    expect(markup).toContain("5-Control")
    expect(markup).toContain('aria-label="Pain: complete"')
    expect(markup).toContain('aria-label="Power: missing"')
    expect(markup).toContain('aria-label="Vision: complete"')
    expect(markup).toContain('name="ppvvc-control"')
  })
})
