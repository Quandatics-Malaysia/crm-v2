CREATE TYPE "deployment_subscription_status" AS ENUM('active', 'past_due', 'suspended', 'cancelled');
--> statement-breakpoint
CREATE TYPE "entitlement_application_outcome" AS ENUM('accepted', 'rejected');
--> statement-breakpoint
CREATE TABLE "deployment_control_state" (
  "singleton" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
  "deployment_id" text,
  "current_revision" bigint DEFAULT 0 NOT NULL,
  "canonical_envelope" text,
  "canonical_payload" text,
  "envelope_digest" char(64),
  "key_id" text,
  "signature" text,
  "issued_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone,
  "contract_starts_at" timestamp with time zone,
  "contract_ends_at" timestamp with time zone,
  "grace_until" timestamp with time zone,
  "subscription_status" "deployment_subscription_status",
  "seat_limit" integer,
  "module_ids" text[],
  "greatest_trusted_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  CONSTRAINT "deployment_control_state_singleton_check" CHECK ("singleton" = 1),
  CONSTRAINT "deployment_control_state_deployment_uq" UNIQUE("deployment_id"),
  CONSTRAINT "deployment_control_state_revision_check" CHECK ("current_revision" >= 0),
  CONSTRAINT "deployment_control_state_bundle_check" CHECK (
    ("current_revision" = 0 AND "deployment_id" IS NULL)
    OR
    ("current_revision" > 0 AND "deployment_id" IS NOT NULL AND "canonical_envelope" IS NOT NULL
      AND "canonical_payload" IS NOT NULL AND "envelope_digest" IS NOT NULL AND "key_id" IS NOT NULL
      AND "signature" IS NOT NULL AND "issued_at" IS NOT NULL AND "lease_expires_at" IS NOT NULL
      AND "contract_starts_at" IS NOT NULL AND "contract_ends_at" IS NOT NULL AND "grace_until" IS NOT NULL
      AND "subscription_status" IS NOT NULL AND "seat_limit" IS NOT NULL AND "module_ids" IS NOT NULL
      AND "greatest_trusted_at" IS NOT NULL AND "accepted_at" IS NOT NULL)
  ),
  CONSTRAINT "deployment_control_state_seat_limit_check" CHECK ("seat_limit" IS NULL OR "seat_limit" BETWEEN 1 AND 100000),
  CONSTRAINT "deployment_control_state_digest_check" CHECK ("envelope_digest" IS NULL OR "envelope_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "deployment_control_state_key_id_check" CHECK ("key_id" IS NULL OR length("key_id") BETWEEN 1 AND 128),
  CONSTRAINT "deployment_control_state_signature_check" CHECK ("signature" IS NULL OR length("signature") BETWEEN 1 AND 512),
  CONSTRAINT "deployment_control_state_envelope_size_check" CHECK ("canonical_envelope" IS NULL OR octet_length("canonical_envelope") <= 131072),
  CONSTRAINT "deployment_control_state_payload_size_check" CHECK ("canonical_payload" IS NULL OR octet_length("canonical_payload") <= 65536),
  CONSTRAINT "deployment_control_state_contract_check" CHECK ("contract_ends_at" IS NULL OR "contract_ends_at" >= "contract_starts_at"),
  CONSTRAINT "deployment_control_state_lease_check" CHECK ("lease_expires_at" IS NULL OR ("lease_expires_at" >= "issued_at" AND "grace_until" >= "lease_expires_at"))
);
--> statement-breakpoint
INSERT INTO "deployment_control_state" ("singleton", "current_revision") VALUES (1, 0);
--> statement-breakpoint
CREATE TABLE "deployment_entitlement_history" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "outcome" "entitlement_application_outcome" NOT NULL,
  "reason" text NOT NULL,
  "envelope_digest" char(64) NOT NULL,
  "revision" bigint,
  "received_at" timestamp with time zone NOT NULL,
  CONSTRAINT "deployment_entitlement_history_reason_check" CHECK ("reason" ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT "deployment_entitlement_history_digest_check" CHECK ("envelope_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "deployment_entitlement_history_revision_check" CHECK ("revision" IS NULL OR "revision" > 0)
);
--> statement-breakpoint
CREATE INDEX "deployment_entitlement_history_received_idx"
  ON "deployment_entitlement_history" USING btree ("received_at");
--> statement-breakpoint
CREATE FUNCTION deployment_entitlement_history_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'deployment entitlement history is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER deployment_entitlement_history_no_update
BEFORE UPDATE ON deployment_entitlement_history
FOR EACH ROW EXECUTE FUNCTION deployment_entitlement_history_immutable();
--> statement-breakpoint
CREATE TRIGGER deployment_entitlement_history_no_delete
BEFORE DELETE ON deployment_entitlement_history
FOR EACH ROW EXECUTE FUNCTION deployment_entitlement_history_immutable();
--> statement-breakpoint
CREATE FUNCTION record_deployment_entitlement_rejection(
  p_reason text,
  p_digest text,
  p_revision bigint,
  p_received_at timestamp with time zone
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_reason !~ '^[a-z][a-z0-9_]{0,63}$'
    OR p_digest !~ '^[0-9a-f]{64}$'
    OR (p_revision IS NOT NULL AND p_revision <= 0)
  THEN
    RAISE EXCEPTION 'invalid entitlement rejection metadata';
  END IF;

  INSERT INTO public.deployment_entitlement_history (
    outcome, reason, envelope_digest, revision, received_at
  ) VALUES ('rejected', p_reason, p_digest, p_revision, p_received_at);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION apply_verified_deployment_entitlement(
  p_expected_deployment_id text,
  p_deployment_id text,
  p_revision bigint,
  p_canonical_envelope text,
  p_canonical_payload text,
  p_digest text,
  p_key_id text,
  p_signature text,
  p_issued_at timestamp with time zone,
  p_lease_expires_at timestamp with time zone,
  p_contract_starts_at timestamp with time zone,
  p_contract_ends_at timestamp with time zone,
  p_grace_until timestamp with time zone,
  p_subscription_status public.deployment_subscription_status,
  p_seat_limit integer,
  p_module_ids text[],
  p_received_at timestamp with time zone
)
RETURNS TABLE(outcome text, reason text, current_revision bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_state public.deployment_control_state%ROWTYPE;
BEGIN
  IF p_expected_deployment_id <> p_deployment_id THEN
    INSERT INTO public.deployment_entitlement_history (outcome, reason, envelope_digest, revision, received_at)
    VALUES ('rejected', 'deployment_mismatch', p_digest, p_revision, p_received_at);
    RETURN QUERY SELECT 'rejected'::text, 'deployment_mismatch'::text, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO current_state
  FROM public.deployment_control_state
  WHERE singleton = 1
  FOR UPDATE;

  IF current_state.deployment_id IS NOT NULL AND current_state.deployment_id <> p_expected_deployment_id THEN
    INSERT INTO public.deployment_entitlement_history (outcome, reason, envelope_digest, revision, received_at)
    VALUES ('rejected', 'deployment_binding_conflict', p_digest, p_revision, p_received_at);
    RETURN QUERY SELECT 'rejected'::text, 'deployment_binding_conflict'::text, current_state.current_revision;
    RETURN;
  END IF;

  IF p_revision < current_state.current_revision THEN
    INSERT INTO public.deployment_entitlement_history (outcome, reason, envelope_digest, revision, received_at)
    VALUES ('rejected', 'revision_downgrade', p_digest, p_revision, p_received_at);
    RETURN QUERY SELECT 'rejected'::text, 'revision_downgrade'::text, current_state.current_revision;
    RETURN;
  END IF;

  IF p_revision = current_state.current_revision THEN
    IF p_canonical_envelope = current_state.canonical_envelope THEN
      UPDATE public.deployment_control_state state
      SET greatest_trusted_at = GREATEST(state.greatest_trusted_at, p_issued_at, p_received_at)
      WHERE state.singleton = 1;
      INSERT INTO public.deployment_entitlement_history (outcome, reason, envelope_digest, revision, received_at)
      VALUES ('accepted', 'idempotent_replay', p_digest, p_revision, p_received_at);
      RETURN QUERY SELECT 'idempotent'::text, 'idempotent_replay'::text, current_state.current_revision;
    ELSE
      INSERT INTO public.deployment_entitlement_history (outcome, reason, envelope_digest, revision, received_at)
      VALUES ('rejected', 'revision_conflict', p_digest, p_revision, p_received_at);
      RETURN QUERY SELECT 'rejected'::text, 'revision_conflict'::text, current_state.current_revision;
    END IF;
    RETURN;
  END IF;

  INSERT INTO public.deployment_control_state (
    singleton, deployment_id, current_revision, canonical_envelope, canonical_payload,
    envelope_digest, key_id, signature, issued_at, lease_expires_at,
    contract_starts_at, contract_ends_at, grace_until, subscription_status,
    seat_limit, module_ids, greatest_trusted_at, accepted_at
  ) VALUES (
    1, p_deployment_id, p_revision, p_canonical_envelope, p_canonical_payload,
    p_digest, p_key_id, p_signature, p_issued_at, p_lease_expires_at,
    p_contract_starts_at, p_contract_ends_at, p_grace_until, p_subscription_status,
    p_seat_limit, p_module_ids, GREATEST(p_issued_at, p_received_at), p_received_at
  )
  ON CONFLICT (singleton) DO UPDATE SET
    deployment_id = EXCLUDED.deployment_id,
    current_revision = EXCLUDED.current_revision,
    canonical_envelope = EXCLUDED.canonical_envelope,
    canonical_payload = EXCLUDED.canonical_payload,
    envelope_digest = EXCLUDED.envelope_digest,
    key_id = EXCLUDED.key_id,
    signature = EXCLUDED.signature,
    issued_at = EXCLUDED.issued_at,
    lease_expires_at = EXCLUDED.lease_expires_at,
    contract_starts_at = EXCLUDED.contract_starts_at,
    contract_ends_at = EXCLUDED.contract_ends_at,
    grace_until = EXCLUDED.grace_until,
    subscription_status = EXCLUDED.subscription_status,
    seat_limit = EXCLUDED.seat_limit,
    module_ids = EXCLUDED.module_ids,
    greatest_trusted_at = GREATEST(
      COALESCE(public.deployment_control_state.greatest_trusted_at, EXCLUDED.greatest_trusted_at),
      EXCLUDED.greatest_trusted_at
    ),
    accepted_at = EXCLUDED.accepted_at;

  INSERT INTO public.deployment_entitlement_history (outcome, reason, envelope_digest, revision, received_at)
  VALUES ('accepted', 'accepted', p_digest, p_revision, p_received_at);
  RETURN QUERY SELECT 'accepted'::text, 'accepted'::text, p_revision;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION read_deployment_entitlement_state(
  p_observed_at timestamp with time zone DEFAULT NULL
)
RETURNS TABLE(
  deployment_id text,
  current_revision bigint,
  canonical_envelope text,
  canonical_payload text,
  key_id text,
  issued_at timestamp with time zone,
  lease_expires_at timestamp with time zone,
  contract_starts_at timestamp with time zone,
  contract_ends_at timestamp with time zone,
  grace_until timestamp with time zone,
  subscription_status public.deployment_subscription_status,
  seat_limit integer,
  module_ids text[],
  greatest_trusted_at timestamp with time zone
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  checkpoint_interval constant interval := interval '60 seconds';
BEGIN
  -- The common path is read-only. A wall-time observation is durably
  -- checkpointed at most once per 60 seconds, bounding rollback recovery
  -- without turning every authorization read into a row update/WAL write.
  IF p_observed_at IS NOT NULL THEN
    -- PostgreSQL rechecks this predicate after waiting for a concurrent row
    -- lock. Identical boundary observations therefore write once, while a
    -- materially later waiter still advances to the highest observed time.
    UPDATE public.deployment_control_state state
    SET greatest_trusted_at = GREATEST(state.greatest_trusted_at, p_observed_at)
    WHERE state.singleton = 1
      AND state.current_revision > 0
      AND state.greatest_trusted_at <= p_observed_at - checkpoint_interval;
  END IF;

  RETURN QUERY
  SELECT
    state.deployment_id, state.current_revision, state.canonical_envelope, state.canonical_payload,
    state.key_id, state.issued_at, state.lease_expires_at, state.contract_starts_at, state.contract_ends_at,
    state.grace_until, state.subscription_status, state.seat_limit, state.module_ids, state.greatest_trusted_at
  FROM public.deployment_control_state state
  WHERE state.singleton = 1 AND state.current_revision > 0;
END;
$$;
--> statement-breakpoint
ALTER TABLE deployment_control_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_control_state FORCE ROW LEVEL SECURITY;
ALTER TABLE deployment_entitlement_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_entitlement_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON deployment_control_state FROM PUBLIC;
REVOKE ALL ON deployment_entitlement_history FROM PUBLIC;
REVOKE ALL ON SEQUENCE deployment_entitlement_history_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION record_deployment_entitlement_rejection(text, text, bigint, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_verified_deployment_entitlement(text, text, bigint, text, text, text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, public.deployment_subscription_status, integer, text[], timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION read_deployment_entitlement_state(timestamp with time zone) FROM PUBLIC;
