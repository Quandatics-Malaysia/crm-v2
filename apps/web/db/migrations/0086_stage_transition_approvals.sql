-- Require approval for every forward stage entry, including 0E and 1D.
-- KIV reopen and Closed Lost reopen approval/reason behavior is enforced by
-- the shared transition policy; this migration normalizes persisted defaults.
UPDATE pipeline_stages
SET requires_approval_to_enter = true
WHERE kind IN ('OPEN', 'WON');
