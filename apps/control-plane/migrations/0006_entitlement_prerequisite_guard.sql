CREATE TRIGGER entitlement_versions_prerequisite_guard
BEFORE INSERT ON entitlement_versions
WHEN NOT EXISTS (
  SELECT 1
  FROM deployments AS deployment
  JOIN clients AS client ON client.id = deployment.client_id
  JOIN contracts AS contract
    ON contract.id = NEW.contract_id
   AND contract.client_id = deployment.client_id
  WHERE deployment.id = NEW.deployment_id
    AND deployment.status = 'active'
    AND client.status = 'active'
    AND deployment.registered_at IS NOT NULL
    AND deployment.registration_key_fingerprint IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM deployment_keys AS deployment_key
      WHERE deployment_key.deployment_id = deployment.id
        AND deployment_key.algorithm = 'Ed25519'
        AND deployment_key.revoked_at IS NULL
        AND deployment_key.replaced_by_key_id IS NULL
        AND deployment_key.not_before <= NEW.issued_at
        AND (deployment_key.expires_at IS NULL OR deployment_key.expires_at > NEW.issued_at)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'entitlement issuance prerequisites unavailable');
END;
