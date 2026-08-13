ALTER TABLE install_tokens ADD COLUMN superseded_at TEXT;
ALTER TABLE install_tokens ADD COLUMN idempotency_key_digest TEXT
CHECK (idempotency_key_digest IS NULL OR length(idempotency_key_digest) = 43);

CREATE UNIQUE INDEX install_tokens_deployment_idempotency_idx
ON install_tokens (deployment_id, idempotency_key_digest)
WHERE idempotency_key_digest IS NOT NULL;

CREATE INDEX install_tokens_deployment_active_idx
ON install_tokens (deployment_id, used_at, superseded_at, expires_at);
