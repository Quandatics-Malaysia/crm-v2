PRAGMA foreign_keys = ON;

CREATE TABLE operator_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  plan_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE module_catalog (
  module_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  dependency_ids_json TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  client_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE deployments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  deployment_key TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE deployment_keys (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL,
  public_jwk_json TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (deployment_id, key_id)
);

CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  seat_limit INTEGER NOT NULL CHECK (seat_limit BETWEEN 1 AND 100000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (ends_at >= starts_at)
);

CREATE TABLE contract_modules (
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES module_catalog(module_id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (contract_id, module_id)
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  invoice_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  paid_at TEXT,
  currency TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (due_at >= issued_at)
);

CREATE TABLE entitlement_versions (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  key_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  signature TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (deployment_id, version)
);

CREATE TABLE heartbeat_rollups (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  occupied_seats INTEGER NOT NULL CHECK (occupied_seats >= 0),
  application_version TEXT NOT NULL,
  health_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE install_tokens (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  token_digest TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE operator_roles (
  operator_id TEXT NOT NULL REFERENCES operator_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (operator_id, role)
);

CREATE TABLE operator_audit_log (
  id TEXT PRIMARY KEY,
  operator_id TEXT REFERENCES operator_users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  request_id_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX deployments_client_id_idx ON deployments (client_id);
CREATE INDEX deployment_keys_active_idx ON deployment_keys (deployment_id, revoked_at);
CREATE INDEX contracts_client_status_idx ON contracts (client_id, status);
CREATE INDEX contracts_plan_id_idx ON contracts (plan_id);
CREATE INDEX invoices_contract_status_idx ON invoices (contract_id, status);
CREATE INDEX entitlement_versions_contract_id_idx ON entitlement_versions (contract_id);
CREATE INDEX heartbeat_rollups_deployment_observed_idx ON heartbeat_rollups (deployment_id, observed_at);
CREATE INDEX install_tokens_deployment_expiry_idx ON install_tokens (deployment_id, expires_at);
CREATE INDEX operator_audit_log_operator_created_idx ON operator_audit_log (operator_id, created_at);
CREATE INDEX operator_audit_log_target_created_idx ON operator_audit_log (target_type, target_id, created_at);
