ALTER TABLE "persons" DROP CONSTRAINT "persons_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_tenant_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_tenant_idx" ON "leads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "persons_tenant_account_idx" ON "persons" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE INDEX "funnels_tenant_idx" ON "funnels" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "funnels_default_uq" ON "funnels" USING btree ("tenant_id") WHERE "funnels"."is_default";--> statement-breakpoint
CREATE INDEX "opportunities_tenant_stage_idx" ON "opportunities" USING btree ("tenant_id","current_stage_id");--> statement-breakpoint
CREATE INDEX "opportunities_tenant_account_idx" ON "opportunities" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE INDEX "opp_stage_history_opp_idx" ON "opportunity_stage_history" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "attachments_tenant_attachable_idx" ON "attachments" USING btree ("tenant_id","attachable_type","attachable_id");--> statement-breakpoint
CREATE INDEX "quotation_line_items_quotation_idx" ON "quotation_line_items" USING btree ("quotation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_settings_default_uq" ON "tax_settings" USING btree ("tenant_id") WHERE "tax_settings"."is_default";--> statement-breakpoint
CREATE INDEX "payment_milestones_project_idx" ON "payment_milestones" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sales_orders_tenant_project_idx" ON "sales_orders" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_number_uq" ON "sales_orders" USING btree ("tenant_id","so_number") WHERE "sales_orders"."so_number" IS NOT NULL;--> statement-breakpoint
-- ── Hand-authored: FKs that cross schema-file import cycles (drizzle keeps them
-- FK-less in TS to avoid circular imports; ALTER TABLE has no such constraint). ──
ALTER TABLE "leads" ADD CONSTRAINT "leads_funnel_id_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_current_stage_id_funnel_stages_id_fk" FOREIGN KEY ("current_stage_id") REFERENCES "public"."funnel_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_opportunity_id_opportunities_id_fk" FOREIGN KEY ("converted_opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_primary_quotation_id_quotations_id_fk" FOREIGN KEY ("primary_quotation_id") REFERENCES "public"."quotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opp_stage_history_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."stage_approval_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- ── Hand-authored: retarget the remaining account-child FKs to the tenant-safe
-- composite (tenant_id, account_id) -> accounts(tenant_id, id). These use ON
-- DELETE SET NULL on the soft-pointer column only (PG15+), leaving tenant_id. ──
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_parent_account_id_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_parent_account_fk" FOREIGN KEY ("tenant_id","parent_account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE SET NULL ("parent_account_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_end_user_account_id_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_end_user_account_fk" FOREIGN KEY ("tenant_id","end_user_account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE SET NULL ("end_user_account_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_converted_account_id_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_converted_account_fk" FOREIGN KEY ("tenant_id","converted_account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE SET NULL ("converted_account_id") ON UPDATE no action;--> statement-breakpoint
-- ── Hand-authored: singleton superadmin — at most one user row may have
-- is_superadmin = true across the whole deployment. ──
CREATE UNIQUE INDEX "user_singleton_superadmin_uq" ON "user" USING btree ("is_superadmin") WHERE "is_superadmin";