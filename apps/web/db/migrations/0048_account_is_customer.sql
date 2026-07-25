-- Salesforce "Change Account Type Prospect → Customer after Closed Won".
-- crm-v2's account_type is client/reseller (orthogonal), so lifecycle gets its
-- own flag: is_customer flips true when a funnel on the account reaches Won.
ALTER TABLE "accounts" ADD COLUMN "is_customer" boolean DEFAULT false NOT NULL;
