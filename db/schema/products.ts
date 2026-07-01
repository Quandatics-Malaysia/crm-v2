import {
  pgTable,
  uuid,
  text,
  char,
  numeric,
  boolean,
  unique,
  index,
} from "drizzle-orm/pg-core"
import { organization } from "./auth"
import { timestamps, softDelete } from "./_helpers"

/**
 * Standardised product catalog (single price per product). A quotation line
 * item can reference one of these to auto-fill its description + unit price.
 *
 * `productCode` is a value from the tenant's product-code picklist
 * (tenant_settings.product_codes) identifying the product line; `subcategory`
 * is a free-text refinement. Pricing is a single `standardPrice` in `currency`
 * (multi-currency price books are intentionally out of scope for now).
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Product-line code (value from tenant_settings.product_codes). */
    productCode: text("product_code"),
    /** Free-text subcategory (e.g. "Data Analytics"). */
    subcategory: text("subcategory"),
    /** Unit of measure (e.g. "Day", "Unit", "Licence"). */
    uom: text("uom"),
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    standardPrice: numeric("standard_price", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    // Tenant-safe composite handle for any future cross-table FK.
    unique("products_tenant_id_uq").on(t.tenantId, t.id),
    index("products_tenant_idx").on(t.tenantId),
  ]
)
