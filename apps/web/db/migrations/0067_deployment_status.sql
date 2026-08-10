CREATE TYPE "deployment_seat_reservation_status" AS ENUM('reserved', 'released', 'consumed', 'expired');
--> statement-breakpoint
CREATE TABLE "deployment_seat_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invitation_id" text NOT NULL,
  "normalized_email" text NOT NULL,
  "status" "deployment_seat_reservation_status" DEFAULT 'reserved' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "deployment_seat_reservations_identity_check" CHECK (
    length("normalized_email") BETWEEN 3 AND 320
    AND "normalized_email" = lower(btrim("normalized_email"))
    AND "normalized_email" !~ '[[:space:]]'
  ),
  CONSTRAINT "deployment_seat_reservations_invitation_check" CHECK (length("invitation_id") BETWEEN 1 AND 256)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_seat_reservations_invitation_uq"
  ON "deployment_seat_reservations" USING btree ("invitation_id");
--> statement-breakpoint
CREATE INDEX "deployment_seat_reservations_live_identity_idx"
  ON "deployment_seat_reservations" USING btree ("status", "expires_at", "normalized_email");
--> statement-breakpoint
CREATE TABLE "deployment_runtime_metadata" (
  "singleton" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
  "migration_version" text NOT NULL,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "deployment_runtime_metadata_singleton_check" CHECK ("singleton" = 1),
  CONSTRAINT "deployment_runtime_metadata_version_check" CHECK ("migration_version" ~ '^[A-Za-z0-9._-]{1,128}$')
);
--> statement-breakpoint
INSERT INTO "deployment_runtime_metadata" ("singleton", "migration_version") VALUES (1, '0067');
--> statement-breakpoint
ALTER TABLE deployment_seat_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_seat_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE deployment_runtime_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_runtime_metadata FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON deployment_seat_reservations FROM PUBLIC;
REVOKE ALL ON deployment_runtime_metadata FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION read_deployment_status_rollup()
RETURNS TABLE(
  active_user_count bigint,
  reserved_invitation_count bigint,
  applied_migration_version text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (
      SELECT pg_catalog.count(DISTINCT m.user_id)
      FROM public.membership_profiles mp
      JOIN public.member m ON m.id = mp.member_id
      JOIN public."user" u ON u.id = m.user_id
      WHERE mp.status = 'active'
        -- Current support proxy. Task 4 replaces this with an explicit
        -- non-seat-consuming support identity marker.
        AND u.is_superadmin IS NOT TRUE
    )::bigint,
    (
      SELECT pg_catalog.count(DISTINCT reservation.normalized_email)
      FROM public.deployment_seat_reservations reservation
      WHERE reservation.status = 'reserved'
        AND reservation.expires_at > pg_catalog.statement_timestamp()
        AND NOT EXISTS (
          SELECT 1
          FROM public.membership_profiles active_profile
          JOIN public.member active_member ON active_member.id = active_profile.member_id
          JOIN public."user" active_user ON active_user.id = active_member.user_id
          WHERE active_profile.status = 'active'
            AND pg_catalog.lower(pg_catalog.btrim(active_user.email)) = reservation.normalized_email
        )
    )::bigint,
    (
      SELECT metadata.migration_version
      FROM public.deployment_runtime_metadata metadata
      WHERE metadata.singleton = 1
    )::text;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION read_deployment_status_rollup() FROM PUBLIC;
