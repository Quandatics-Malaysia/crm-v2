CREATE TRIGGER install_token_issuance_prerequisite_guard
BEFORE INSERT ON install_tokens
WHEN NEW.used_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'install token issuance prerequisites unavailable')
  WHERE NOT EXISTS (
    SELECT 1
    FROM deployments AS deployment
    JOIN clients AS client ON client.id = deployment.client_id
    WHERE deployment.id = NEW.deployment_id
      AND deployment.status = 'active'
      AND client.status = 'active'
      AND deployment.registered_at IS NULL
      AND deployment.registration_key_fingerprint IS NULL
  );
END;
