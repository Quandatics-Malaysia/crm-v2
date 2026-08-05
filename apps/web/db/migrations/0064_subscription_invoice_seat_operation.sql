ALTER TABLE "platform_subscription_invoices"
  ADD COLUMN "seat_operation" text DEFAULT 'add' NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_subscription_invoices"
  ADD CONSTRAINT "platform_subscription_invoices_seat_operation_check"
  CHECK ("seat_operation" IN ('set', 'add'));
