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
    await context.setExtraHTTPHeaders({
      cookie: request.headers.get("cookie") ?? "",
    })
    const page = await context.newPage()
    await page.goto(url.toString(), { waitUntil: "networkidle" })
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
        "Cache-Control": "private, no-store",
      },
    })
  } finally {
    await browser.close()
  }
}
