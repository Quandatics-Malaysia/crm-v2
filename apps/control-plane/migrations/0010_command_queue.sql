-- Vendor remote-command channel: per-deployment FIFO queue plus ack audit and replay protection.

CREATE TABLE deployment_command_queue (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  vendor_key_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  signature TEXT NOT NULL,
  expected_kind TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'in_flight', 'acked', 'expired', 'cancelled')),
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  claimed_by_actor TEXT,
  completed_at TEXT,
  ack_payload_json TEXT,
  ack_outcome TEXT,
  ack_error_code TEXT,
  artifact_kind TEXT,
  artifact_sha256 TEXT,
  artifact_storage_key TEXT,
  artifact_byte_length INTEGER,
  operator_id TEXT REFERENCES operator_users(id),
  operator_request_id TEXT,
  CHECK (length(id) = 36),
  CHECK (length(deployment_id) = 36),
  CHECK (state != 'acked' OR ack_payload_json IS NOT NULL),
  CHECK (state != 'acked' OR completed_at IS NOT NULL),
  CHECK (state != 'in_flight' OR claimed_at IS NOT NULL),
  CHECK (state != 'in_flight' OR completed_at IS NULL),
  CHECK ((state IN ('acked', 'cancelled', 'expired')) = (completed_at IS NOT NULL))
);

CREATE INDEX deployment_command_queue_deployment_pending_idx
  ON deployment_command_queue (deployment_id, state, issued_at)
  WHERE state = 'pending';

CREATE INDEX deployment_command_queue_deployment_state_idx
  ON deployment_command_queue (deployment_id, state);

CREATE INDEX deployment_command_queue_expires_idx
  ON deployment_command_queue (expires_at)
  WHERE state IN ('pending', 'in_flight');

CREATE INDEX deployment_command_queue_claim_idx
  ON deployment_command_queue (state, deployment_id, issued_at)
  WHERE state = 'pending';

CREATE TRIGGER deployment_command_queue_pending_insert_guard
BEFORE INSERT ON deployment_command_queue
WHEN NEW.state != 'pending'
  OR NEW.vendor_key_id IS NULL OR length(NEW.vendor_key_id) = 0
  OR NEW.expected_kind IS NULL OR length(NEW.expected_kind) = 0
  OR NEW.issued_at IS NULL OR NEW.expires_at IS NULL
  OR NEW.expires_at <= NEW.issued_at
  OR length(NEW.payload_json) = 0
  OR length(NEW.signature) < 86
BEGIN
  SELECT RAISE(ABORT, 'command queue entry is invalid');
END;

CREATE TRIGGER deployment_command_queue_payload_immutable
BEFORE UPDATE OF payload_json, signature, expected_kind, vendor_key_id, deployment_id, issued_at ON deployment_command_queue
BEGIN
  SELECT RAISE(ABORT, 'command queue payload is immutable');
END;

CREATE TRIGGER deployment_command_queue_claimed_state_machine
BEFORE UPDATE OF state ON deployment_command_queue
WHEN
  (OLD.state = 'pending' AND NEW.state NOT IN ('in_flight', 'cancelled', 'expired'))
  OR (OLD.state = 'in_flight' AND NEW.state NOT IN ('acked', 'expired', 'cancelled'))
  OR (OLD.state IN ('acked', 'cancelled', 'expired') AND NEW.state != OLD.state)
BEGIN
  SELECT RAISE(ABORT, 'command queue state transition is invalid');
END;

CREATE TRIGGER deployment_command_queue_claim_fields
BEFORE UPDATE OF state ON deployment_command_queue
WHEN NEW.state = 'in_flight' AND (NEW.claimed_at IS NULL OR NEW.completed_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'command queue claim fields are invalid');
END;

CREATE TRIGGER deployment_command_queue_acked_fields
BEFORE UPDATE OF state ON deployment_command_queue
WHEN NEW.state = 'acked' AND (NEW.ack_payload_json IS NULL OR NEW.completed_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'command queue ack fields are invalid');
END;

CREATE TABLE deployment_command_audit (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL REFERENCES deployment_command_queue(id) ON DELETE CASCADE,
  vendor_key_id TEXT NOT NULL,
  expected_kind TEXT NOT NULL,
  enqueued_by_operator_id TEXT REFERENCES operator_users(id),
  issued_at TEXT NOT NULL,
  ack_received_at TEXT,
  outcome TEXT,
  error_code TEXT,
  artifact_kind TEXT,
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (length(deployment_id) = 36),
  CHECK (length(command_id) = 36)
);

CREATE INDEX deployment_command_audit_deployment_created_idx
  ON deployment_command_audit (deployment_id, created_at);

CREATE INDEX deployment_command_audit_operator_idx
  ON deployment_command_audit (enqueued_by_operator_id, created_at);
