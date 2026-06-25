ALTER TABLE "opportunities" ADD COLUMN "so_number" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "next_step" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "due_at" timestamp with time zone;