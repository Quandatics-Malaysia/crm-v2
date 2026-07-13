ALTER TYPE "activity_type" ADD VALUE IF NOT EXISTS 'update';
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "changes" jsonb;
