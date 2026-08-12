ALTER TABLE client_organisations ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
CHECK (status IN ('active', 'archived'));

ALTER TABLE deployments ADD COLUMN image_digest TEXT;
ALTER TABLE deployments ADD COLUMN archived_at TEXT;

ALTER TABLE contracts ADD COLUMN archived_at TEXT;

INSERT OR IGNORE INTO plans (
  id, plan_key, display_name, active, created_at, updated_at
) VALUES (
  'plan-core-crm', 'core-crm', 'Core CRM', 1,
  '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
);

CREATE INDEX client_organisations_status_idx
ON client_organisations (client_id, status);

CREATE INDEX deployments_status_idx ON deployments (status, client_id);
CREATE INDEX contracts_archived_idx ON contracts (archived_at, client_id);
