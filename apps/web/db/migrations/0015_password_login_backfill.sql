-- Backfill: existing tenants created under the old default (allow_password_login = false)
-- would be locked out now that the flag is enforced at sign-in. Re-enable password
-- login for them; SSO-only remains opt-in going forward (a tenant can turn it back off).
UPDATE tenant_settings SET allow_password_login = true WHERE allow_password_login = false;
