ALTER TABLE operator_users
ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
CHECK (status IN ('active', 'disabled'));

ALTER TABLE operator_users
ADD COLUMN access_subject TEXT;

CREATE UNIQUE INDEX operator_users_access_subject_idx
ON operator_users (access_subject)
WHERE access_subject IS NOT NULL;

DELETE FROM operator_roles
WHERE role NOT IN (
  'vendor_owner',
  'vendor_support',
  'release_manager',
  'billing_operator',
  'auditor'
);

ALTER TABLE operator_audit_log
ADD COLUMN outcome TEXT NOT NULL DEFAULT 'success'
CHECK (outcome IN ('success', 'denied', 'error'));

CREATE INDEX operator_audit_log_action_created_idx
ON operator_audit_log (action, created_at);

CREATE TRIGGER operator_audit_log_no_update
BEFORE UPDATE ON operator_audit_log
BEGIN
  SELECT RAISE(ABORT, 'operator audit log is append-only');
END;

CREATE TRIGGER operator_audit_log_no_delete
BEFORE DELETE ON operator_audit_log
BEGIN
  SELECT RAISE(ABORT, 'operator audit log is append-only');
END;
