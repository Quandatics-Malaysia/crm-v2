import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listProductCodes } from "@/lib/lookups"
import { listProducts } from "./actions"
import { ProductsTable } from "./products-table"

export default async function ProductsPage() {
  const [products, productCodes] = await Promise.all([
    listProducts(),
    listProductCodes(),
  ])

  return (
    <>
      <SiteHeader title="Products" />
      <PageBody>
        <ProductsTable data={products} productCodes={productCodes} />
      </PageBody>
    </>
  )
}
