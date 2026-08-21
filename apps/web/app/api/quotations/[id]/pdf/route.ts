import { getQuotationDocument } from "@/app/(app)/quotations/actions"

function safeFilename(value: string): string {
  const filename = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return `${filename || "quotation"}.pdf`
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const document = await getQuotationDocument(id)
  if (!document) {
    return Response.json({ error: "Quotation not found" }, { status: 404 })
  }

  try {
    const cookieHeader = request.headers.get("cookie") ?? ""
    const cookies = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=")
        return {
          name: separator >= 0 ? part.slice(0, separator) : part,
          value: separator >= 0 ? part.slice(separator + 1) : "",
          domain: "web",
          path: "/",
        }
      })
      .filter((cookie) => cookie.value.length > 0)

    const form = new FormData()
    form.set("url", `http://web:3000/quotation-preview/${id}`)
    form.set("cookies", JSON.stringify(cookies))
    form.set("paperWidth", "8.27")
    form.set("paperHeight", "11.69")
    form.set("marginTop", "0")
    form.set("marginBottom", "0")
    form.set("marginLeft", "0")
    form.set("marginRight", "0")
    form.set("printBackground", "true")
    form.set("preferCssPageSize", "true")

    const response = await fetch(
      `${process.env.GOTENBERG_URL ?? "http://gotenberg:3000"}/forms/chromium/convert/url`,
      { method: "POST", body: form, signal: AbortSignal.timeout(30_000) }
    )
    if (!response.ok) {
      throw new Error(`Gotenberg returned HTTP ${response.status}: ${await response.text()}`)
    }
    const pdf = new Uint8Array(await response.arrayBuffer())
    if (new TextDecoder().decode(pdf.slice(0, 5)) !== "%PDF-") {
      throw new Error("Gotenberg returned a non-PDF response")
    }

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename(document.quotation.quoteNumber)}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    console.error("[quotation-pdf] render failed", { quotationId: id, error })
    return Response.json(
      { error: "Quotation PDF rendering failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    )
  }
}
