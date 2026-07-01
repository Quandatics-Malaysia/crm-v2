ALTER TABLE "quotation_line_items" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "quotation_line_items" ADD COLUMN "uom" text;--> statement-breakpoint
ALTER TABLE "quotation_line_items" ADD CONSTRAINT "quotation_line_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;