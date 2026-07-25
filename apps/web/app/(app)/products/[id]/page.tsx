import { notFound } from "next/navigation"

import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { listProductCodes, listCurrencies } from "@/lib/lookups"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { formatMoney } from "@/lib/format"
import { getProduct, listProductUsage, listProductDeals } from "../actions"
import { ProductForm } from "../product-form"
import { ProductDetailBody } from "../product-detail-body"

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [product, productCodes, currencies, usage, deals, ctx] = await Promise.all([
    getProduct(id),
    listProductCodes(),
    listCurrencies(),
    listProductUsage(id),
    listProductDeals(id),
    requireContext(),
  ])
  if (!product) notFound()

  const canUpdate = ctx.can(PERMISSIONS.PRODUCT_UPDATE)
  const codeName =
    productCodes.find((c) => c.code === product.productCode)?.name ?? null

  return (
    <>
      <SiteHeader
        title={product.name}
        breadcrumbs={[
          { label: "Products", href: "/products" },
          { label: product.name },
        ]}
      />
      <PageBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {product.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatMoney(product.standardPrice, product.currency)}
              {product.uom ? ` / ${product.uom}` : ""}
            </p>
          </div>
          {canUpdate ? (
            <ProductForm
              product={product}
              productCodes={productCodes}
              currencies={currencies}
              trigger={<Button variant="outline">Edit</Button>}
            />
          ) : null}
        </div>

        <ProductDetailBody
          product={product}
          codeName={codeName}
          usage={usage}
          deals={deals}
          productCodes={productCodes}
          canEdit={canUpdate}
        />
      </PageBody>
    </>
  )
}
