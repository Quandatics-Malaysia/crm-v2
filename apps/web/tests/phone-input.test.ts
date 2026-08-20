import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PhoneInput } from "@/components/phone-input"

describe("PhoneInput", () => {
  it("renders standalone controlled fields without a form context", () => {
    const html = renderToStaticMarkup(
      React.createElement(PhoneInput, {
        standalone: true,
        label: "Company phone",
        value: "",
        onChange: () => undefined,
      }),
    )
    expect(html).toContain("Company phone")
    expect(html).toContain("Selected country")
  })
})
