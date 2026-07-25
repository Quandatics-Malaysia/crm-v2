ALTER TABLE "tenant_settings" ADD COLUMN "so_next_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "so_pad_width" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "end_user_account_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_end_user_account_id_accounts_id_fk" FOREIGN KEY ("end_user_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;