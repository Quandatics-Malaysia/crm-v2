ALTER TYPE "public"."stage_change_source" ADD VALUE 'reopen';--> statement-breakpoint
ALTER TABLE "tenant_settings" ALTER COLUMN "allow_password_login" SET DEFAULT true;