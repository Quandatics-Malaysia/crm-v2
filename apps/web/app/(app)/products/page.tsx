import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listProductCodes, listCurrencies } from "@/lib/lookups"
import { listProducts } from "./actions"
import { ProductsTable } from "./products-table"

export default async function ProductsPage() {
  const [products, productCodes, currencies] = await Promise.all([
    listProducts(),
    listProductCodes(),
    listCurrencies(),
  ])

  return (
    <>
      <SiteHeader title="Products" />
      <PageBody>
        <ProductsTable data={products} productCodes={productCodes} currencies={currencies} />
      </PageBody>
    </>
  )
}
