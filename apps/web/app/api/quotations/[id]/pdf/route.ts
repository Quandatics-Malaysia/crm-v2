import { chromium } from "playwright-core"

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

  const url = new URL(`/quotation-preview/${id}`, request.url)
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })

  try {
    const context = await browser.newContext()
    const cookieHeader = request.headers.get("cookie") ?? ""
    if (cookieHeader) {
      const origin = new URL(request.url).origin
      await context.addCookies(
        cookieHeader
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const separator = part.indexOf("=")
            return {
              name: separator >= 0 ? part.slice(0, separator) : part,
              value: separator >= 0 ? part.slice(separator + 1) : "",
              url: origin,
            }
          })
      )
    }
    const page = await context.newPage()
    const response = await page.goto(url.toString(), { waitUntil: "networkidle" })
    if (!response || response.status() >= 400) {
      throw new Error(`Quotation preview returned HTTP ${response?.status() ?? "no response"}`)
    }
    const pdf = await page.pdf({
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    })

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename(document.quotation.quoteNumber)}"`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "private, no-store",
      },
    })
  } finally {
    await browser.close()
  }
}
