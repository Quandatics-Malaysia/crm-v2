ALTER TABLE tenant_settings
  ADD COLUMN subscription_plan text NOT NULL DEFAULT 'Starter',
  ADD COLUMN subscription_status text NOT NULL DEFAULT 'active',
  ADD COLUMN subscription_seat_limit integer,
  ADD COLUMN subscription_starts_at timestamp with time zone,
  ADD COLUMN subscription_ends_at timestamp with time zone;
