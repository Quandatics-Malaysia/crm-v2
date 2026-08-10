ALTER TABLE contracts ADD COLUMN renewal_policy TEXT NOT NULL DEFAULT 'auto_renew'
CHECK (renewal_policy IN ('auto_renew', 'non_renewing'));
ALTER TABLE contracts ADD COLUMN suspension_at TEXT;
ALTER TABLE contracts ADD COLUMN scheduled_seat_limit INTEGER
CHECK (scheduled_seat_limit BETWEEN 1 AND 100000);
ALTER TABLE contracts ADD COLUMN seat_limit_effective_at TEXT;
ALTER TABLE contracts ADD COLUMN entitlement_revision INTEGER NOT NULL DEFAULT 1
CHECK (entitlement_revision >= 1);

CREATE TRIGGER contracts_entitlement_state_insert
BEFORE INSERT ON contracts
WHEN NEW.status NOT IN ('active', 'past_due', 'suspended', 'cancelled')
  OR (NEW.scheduled_seat_limit IS NULL) != (NEW.seat_limit_effective_at IS NULL)
  OR (NEW.scheduled_seat_limit IS NOT NULL AND NEW.scheduled_seat_limit >= NEW.seat_limit)
BEGIN
  SELECT RAISE(ABORT, 'contract entitlement state is invalid');
END;

CREATE TRIGGER contracts_entitlement_state_update
BEFORE UPDATE OF status, seat_limit, renewal_policy, suspension_at, scheduled_seat_limit, seat_limit_effective_at ON contracts
WHEN NEW.status NOT IN ('active', 'past_due', 'suspended', 'cancelled')
  OR NEW.renewal_policy NOT IN ('auto_renew', 'non_renewing')
  OR (NEW.scheduled_seat_limit IS NULL) != (NEW.seat_limit_effective_at IS NULL)
  OR (NEW.scheduled_seat_limit IS NOT NULL AND NEW.scheduled_seat_limit >= NEW.seat_limit)
BEGIN
  SELECT RAISE(ABORT, 'contract entitlement state is invalid');
END;

CREATE TABLE deployment_entitlement_sequences (
  deployment_id TEXT PRIMARY KEY REFERENCES deployments(id) ON DELETE CASCADE,
  next_version INTEGER NOT NULL CHECK (next_version >= 2)
);

INSERT INTO deployment_entitlement_sequences (deployment_id, next_version)
SELECT deployment_id, MAX(version) + 1
FROM entitlement_versions
GROUP BY deployment_id;

CREATE TABLE deployment_entitlement_schedules (
  deployment_id TEXT PRIMARY KEY REFERENCES deployments(id) ON DELETE CASCADE,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  next_check_at TEXT NOT NULL,
  latest_version INTEGER,
  configuration_version TEXT NOT NULL,
  release_channel TEXT NOT NULL CHECK (release_channel IN ('stable', 'beta', 'canary')),
  minimum_supported_app_version TEXT NOT NULL,
  approved_image_digest TEXT,
  state_revision INTEGER NOT NULL DEFAULT 1 CHECK (state_revision >= 1),
  updated_at TEXT NOT NULL
);

CREATE INDEX deployment_entitlement_schedules_due_idx
ON deployment_entitlement_schedules (next_check_at, deployment_id);

ALTER TABLE entitlement_versions ADD COLUMN issuance_key TEXT;
ALTER TABLE entitlement_versions ADD COLUMN envelope_json TEXT;
ALTER TABLE entitlement_versions ADD COLUMN contract_revision INTEGER;
ALTER TABLE entitlement_versions ADD COLUMN schedule_revision INTEGER;
ALTER TABLE entitlement_versions ADD COLUMN renewal_claim_token TEXT;

CREATE UNIQUE INDEX entitlement_versions_deployment_issuance_key_idx
ON entitlement_versions (deployment_id, issuance_key)
WHERE issuance_key IS NOT NULL;

CREATE TRIGGER entitlement_versions_no_update
BEFORE UPDATE ON entitlement_versions
BEGIN
  SELECT RAISE(ABORT, 'entitlement version is immutable');
END;

CREATE TRIGGER entitlement_versions_no_delete
BEFORE DELETE ON entitlement_versions
BEGIN
  SELECT RAISE(ABORT, 'entitlement version is immutable');
END;

CREATE TABLE entitlement_renewal_claims (
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  issuance_key TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('claimed', 'issued', 'failed')),
  claim_expires_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  retry_at TEXT,
  last_error_code TEXT,
  entitlement_version_id TEXT REFERENCES entitlement_versions(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (deployment_id, issuance_key)
);

CREATE INDEX entitlement_renewal_claims_retry_idx
ON entitlement_renewal_claims (state, retry_at, claim_expires_at);

CREATE TRIGGER entitlement_versions_state_guard
BEFORE INSERT ON entitlement_versions
WHEN NEW.contract_revision IS NULL
  OR NEW.schedule_revision IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM deployment_entitlement_schedules s
    JOIN contracts c ON c.id = s.contract_id
    WHERE s.deployment_id = NEW.deployment_id
      AND s.contract_id = NEW.contract_id
      AND s.state_revision = NEW.schedule_revision
      AND c.entitlement_revision = NEW.contract_revision
  )
  OR (
    NEW.issuance_key LIKE 'auto:%'
    AND (
      NEW.renewal_claim_token IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM entitlement_renewal_claims r
        WHERE r.deployment_id = NEW.deployment_id
          AND r.issuance_key = NEW.issuance_key
          AND r.claim_token = NEW.renewal_claim_token
          AND r.state = 'claimed'
      )
    )
  )
  OR (NEW.issuance_key NOT LIKE 'auto:%' AND NEW.renewal_claim_token IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'entitlement state changed');
END;

CREATE TABLE entitlement_control_operations (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 1),
  created_at TEXT NOT NULL
);

CREATE TRIGGER entitlement_control_operations_revision_guard
BEFORE INSERT ON entitlement_control_operations
WHEN NOT EXISTS (
  SELECT 1 FROM contracts
  WHERE id = NEW.contract_id
    AND entitlement_revision = NEW.expected_revision
)
BEGIN
  SELECT RAISE(ABORT, 'contract entitlement revision changed');
END;

CREATE TRIGGER entitlement_control_operations_no_update
BEFORE UPDATE ON entitlement_control_operations
BEGIN
  SELECT RAISE(ABORT, 'entitlement control operation is immutable');
END;

CREATE TRIGGER entitlement_control_operations_no_delete
BEFORE DELETE ON entitlement_control_operations
BEGIN
  SELECT RAISE(ABORT, 'entitlement control operation is immutable');
END;
