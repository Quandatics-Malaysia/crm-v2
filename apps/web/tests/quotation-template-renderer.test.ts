import { describe, expect, it } from "vitest"

import { renderQuotationTemplate } from "@/lib/quotation-template-renderer"

describe("renderQuotationTemplate", () => {
  it("renders escaped values and repeated lines while removing unsafe markup", () => {
    const result = renderQuotationTemplate({
      htmlTemplate:
        '<div onclick="alert(1)">{{entityName}}<img src="{{logoUrl}}"><script>alert(1)</script>{{#each lines}}<p>{{@index}} {{description}}</p>{{/each}}</div>',
      cssTemplate: '@import url("https://evil.example/style.css"); .x { color: red; } </style><script>alert(1)</script>',
      context: {
        entityName: "<Trusted Entity>",
        logoUrl: "/api/tenant-logo",
        delivery: "14 days",
        paymentTerm: "30 days",
        lines: [
          { description: "First <service>", quantity: "1", lineTotal: "10.00" },
          { description: "Second", quantity: "2", lineTotal: "20.00" },
        ],
      },
    })

    expect(result.html).toContain("&lt;Trusted Entity&gt;")
    expect(result.html).toContain("1 First &lt;service&gt;")
    expect(result.html).toContain("2 Second")
    expect(result.html).toContain('src="/api/tenant-logo"')
    expect(result.html).not.toContain("<script")
    expect(result.html).not.toContain("onclick")
    expect(result.css).not.toContain("@import")
    expect(result.css).not.toContain("url(")
    expect(result.css).not.toContain("</style>")
  })

  it("renders saved quotation content as ordinary escaped template values", () => {
    const result = renderQuotationTemplate({
      htmlTemplate: "{{delivery}}|{{paymentTerm}}|{{notes}}|{{customerContact}}",
      context: {
        delivery: "14 days",
        paymentTerm: "30 days",
        notes: "Saved <note>",
        customerContact: "Ada Contact",
      },
    })

    expect(result.html).toBe("14 days|30 days|Saved &lt;note&gt;|Ada Contact")
  })
})
