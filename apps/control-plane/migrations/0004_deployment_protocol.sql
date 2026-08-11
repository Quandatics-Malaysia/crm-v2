ALTER TABLE deployments ADD COLUMN registered_at TEXT;
ALTER TABLE deployments ADD COLUMN registration_key_fingerprint TEXT;

ALTER TABLE install_tokens ADD COLUMN registration_key_fingerprint TEXT;

ALTER TABLE deployment_keys ADD COLUMN algorithm TEXT
CHECK (algorithm IS NULL OR algorithm = 'Ed25519');
ALTER TABLE deployment_keys ADD COLUMN fingerprint TEXT
CHECK (fingerprint IS NULL OR length(fingerprint) = 43 OR fingerprint = 'legacy:pending');
ALTER TABLE deployment_keys ADD COLUMN not_before TEXT;
ALTER TABLE deployment_keys ADD COLUMN expires_at TEXT;
ALTER TABLE deployment_keys ADD COLUMN replaced_by_key_id TEXT;
ALTER TABLE deployment_keys ADD COLUMN registration_token_id TEXT
REFERENCES install_tokens(id);

UPDATE deployment_keys
SET algorithm = 'Ed25519',
    fingerprint = 'legacy:pending',
    not_before = created_at;

UPDATE deployments
SET registered_at = (
      SELECT MIN(deployment_keys.created_at)
      FROM deployment_keys
      WHERE deployment_keys.deployment_id = deployments.id
    ),
    registration_key_fingerprint = 'legacy:pending'
WHERE EXISTS (
  SELECT 1 FROM deployment_keys WHERE deployment_keys.deployment_id = deployments.id
);

CREATE UNIQUE INDEX deployment_keys_registration_token_idx
ON deployment_keys (registration_token_id)
WHERE registration_token_id IS NOT NULL;

CREATE INDEX deployment_keys_lifecycle_idx
ON deployment_keys (deployment_id, revoked_at, not_before, expires_at);

CREATE TRIGGER deployment_key_protocol_insert
BEFORE INSERT ON deployment_keys
WHEN NEW.algorithm IS NULL
  OR NEW.algorithm != 'Ed25519'
  OR NEW.fingerprint IS NULL
  OR length(NEW.fingerprint) != 43
  OR NEW.not_before IS NULL
  OR length(NEW.key_id) != 36
  OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= NEW.not_before)
BEGIN
  SELECT RAISE(ABORT, 'deployment key protocol fields are invalid');
END;

CREATE TRIGGER deployment_key_protocol_update
BEFORE UPDATE OF key_id, algorithm, fingerprint, not_before, expires_at ON deployment_keys
WHEN NEW.algorithm IS NULL
  OR NEW.algorithm != 'Ed25519'
  OR NEW.fingerprint IS NULL
  OR (length(NEW.fingerprint) != 43 AND NEW.fingerprint != 'legacy:pending')
  OR NEW.not_before IS NULL
  OR length(NEW.key_id) != 36
  OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= NEW.not_before)
BEGIN
  SELECT RAISE(ABORT, 'deployment key protocol fields are invalid');
END;

CREATE TRIGGER deployment_key_identity_immutable
BEFORE UPDATE OF key_id, algorithm, fingerprint ON deployment_keys
WHEN NEW.key_id != OLD.key_id
  OR NEW.algorithm != OLD.algorithm
  OR NEW.fingerprint != OLD.fingerprint
BEGIN
  SELECT RAISE(ABORT, 'deployment key identity is immutable');
END;

CREATE TRIGGER deployment_key_replacement_insert
BEFORE INSERT ON deployment_keys
WHEN NEW.replaced_by_key_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM deployment_keys
    WHERE deployment_id = NEW.deployment_id
      AND key_id = NEW.replaced_by_key_id
  )
BEGIN
  SELECT RAISE(ABORT, 'replacement key must belong to deployment');
END;

CREATE TRIGGER deployment_key_replacement_update
BEFORE UPDATE OF replaced_by_key_id ON deployment_keys
WHEN NEW.replaced_by_key_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM deployment_keys
    WHERE deployment_id = NEW.deployment_id
      AND key_id = NEW.replaced_by_key_id
  )
BEGIN
  SELECT RAISE(ABORT, 'replacement key must belong to deployment');
END;

CREATE TRIGGER deployment_registration_key_gate
BEFORE INSERT ON deployment_keys
WHEN NEW.registration_token_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'registration key claim rejected')
  WHERE NOT EXISTS (
    SELECT 1
    FROM install_tokens AS token
    JOIN deployments AS deployment ON deployment.id = token.deployment_id
    WHERE token.id = NEW.registration_token_id
      AND token.deployment_id = NEW.deployment_id
      AND token.used_at = NEW.created_at
      AND token.registration_key_fingerprint = NEW.fingerprint
      AND deployment.registered_at IS NULL
      AND deployment.registration_key_fingerprint IS NULL
      AND deployment.status = 'active'
  );
END;

CREATE TRIGGER deployment_registration_key_apply
AFTER INSERT ON deployment_keys
WHEN NEW.registration_token_id IS NOT NULL
BEGIN
  UPDATE deployments
  SET registered_at = NEW.created_at,
      registration_key_fingerprint = NEW.fingerprint,
      updated_at = NEW.created_at
  WHERE id = NEW.deployment_id
    AND registered_at IS NULL
    AND registration_key_fingerprint IS NULL;

  SELECT RAISE(ABORT, 'deployment registration rejected')
  WHERE changes() != 1;
END;

CREATE TRIGGER deployments_registration_pair_insert
BEFORE INSERT ON deployments
WHEN (NEW.registered_at IS NULL) != (NEW.registration_key_fingerprint IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'deployment registration state is incomplete');
END;

CREATE TRIGGER deployments_registration_pair_update
BEFORE UPDATE OF registered_at, registration_key_fingerprint ON deployments
WHEN (NEW.registered_at IS NULL) != (NEW.registration_key_fingerprint IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'deployment registration state is incomplete');
END;

CREATE TABLE deployment_request_nonces (
  deployment_key_id TEXT NOT NULL REFERENCES deployment_keys(id) ON DELETE CASCADE,
  nonce_digest TEXT NOT NULL CHECK (length(nonce_digest) = 43),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (deployment_key_id, nonce_digest)
);

CREATE INDEX deployment_request_nonces_expiry_idx
ON deployment_request_nonces (expires_at);

ALTER TABLE heartbeat_rollups ADD COLUMN client_timestamp TEXT;
ALTER TABLE heartbeat_rollups ADD COLUMN image_digest TEXT;
ALTER TABLE heartbeat_rollups ADD COLUMN entitlement_version TEXT;
ALTER TABLE heartbeat_rollups ADD COLUMN configuration_version TEXT;
ALTER TABLE heartbeat_rollups ADD COLUMN active_user_count INTEGER;
ALTER TABLE heartbeat_rollups ADD COLUMN reserved_invitation_count INTEGER;
ALTER TABLE heartbeat_rollups ADD COLUMN enabled_module_ids_json TEXT;
ALTER TABLE heartbeat_rollups ADD COLUMN migration_version TEXT;
ALTER TABLE heartbeat_rollups ADD COLUMN last_successful_backup_at TEXT;
ALTER TABLE heartbeat_rollups ADD COLUMN last_restore_test_at TEXT;
ALTER TABLE heartbeat_rollups ADD COLUMN agent_version TEXT;
