CREATE TABLE client_organisations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  organisation_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (client_id, organisation_key)
);

CREATE INDEX client_organisations_client_id_idx
ON client_organisations (client_id);

ALTER TABLE contracts
ADD COLUMN monthly_seat_price_cents INTEGER NOT NULL DEFAULT 0
CHECK (monthly_seat_price_cents BETWEEN 0 AND 1000000000000);

ALTER TABLE contracts
ADD COLUMN tax_basis_points INTEGER NOT NULL DEFAULT 0
CHECK (tax_basis_points BETWEEN 0 AND 10000);

ALTER TABLE contracts
ADD COLUMN collection_frequency TEXT NOT NULL DEFAULT 'upfront'
CHECK (collection_frequency IN ('monthly', 'upfront'));

ALTER TABLE contracts
ADD COLUMN total_cents INTEGER NOT NULL DEFAULT 0
CHECK (total_cents BETWEEN 0 AND 9007199254740991);

CREATE TABLE invoice_collection_milestones (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (invoice_id, sequence)
);

CREATE INDEX invoice_collection_milestones_invoice_id_idx
ON invoice_collection_milestones (invoice_id);
