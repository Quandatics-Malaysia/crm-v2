#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
compose_file="$script_dir/compose.yaml"
env_file=${1:-$script_dir/.env}
record_tmp=

cleanup() {
  [ -z "$record_tmp" ] || rm -f "$record_tmp"
}
trap cleanup EXIT HUP INT TERM

fail() {
  echo "deploy: $*" >&2
  exit 1
}

required() {
  variable_name=$1
  variable_value=$2
  [ -n "$variable_value" ] || fail "$variable_name is required"
}

reject_placeholder() {
  variable_name=$1
  variable_value=$2
  case "$variable_value" in
    *CHANGE_ME*|*change-me*|*changeme*|*REPLACE_ME*|*replace-me*)
      fail "$variable_name still contains a placeholder"
      ;;
  esac
}

validate_positive_integer() {
  variable_name=$1
  variable_value=$2
  case "$variable_value" in
    ''|*[!0-9]*|0) fail "$variable_name must be a positive integer" ;;
  esac
}

validate_non_negative_integer() {
  variable_name=$1
  variable_value=$2
  case "$variable_value" in
    ''|*[!0-9]*) fail "$variable_name must be a non-negative integer" ;;
  esac
}

validate_digest_image() {
  variable_name=$1
  image_reference=$2
  printf '%s\n' "$image_reference" | grep -Eq '^[a-z0-9.-]+(:[0-9]+)?/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$' ||
    fail "$variable_name must be an immutable sha256 digest reference"
}

marker_value() {
  marker_key=$1
  awk -F= -v marker_key="$marker_key" '$1 == marker_key { sub(/^[^=]*=/, ""); print }' "$BACKUP_MARKER_FILE"
}

assert_marker_equal() {
  marker_key=$1
  expected_value=$2
  actual_value=$(marker_value "$marker_key")
  [ "$actual_value" = "$expected_value" ] || fail "backup marker $marker_key does not match intended release"
}

compose() {
  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$env_file" \
    --file "$compose_file" \
    --profile deploy \
    "$@"
}

case $# in
  0|1) ;;
  *) fail "usage: deploy.sh [env-file]" ;;
esac

[ -f "$env_file" ] || fail "environment file not found: $env_file"
[ -r "$env_file" ] || fail "environment file is not readable: $env_file"

set -a
# The deployment environment is a root-owned shell-compatible file (mode 0600).
# shellcheck disable=SC1090
. "$env_file"
set +a

required COMPOSE_PROJECT_NAME "${COMPOSE_PROJECT_NAME:-}"
required RELEASE_TAG "${RELEASE_TAG:-}"
required WEB_IMAGE "${WEB_IMAGE:-}"
required MIGRATOR_IMAGE "${MIGRATOR_IMAGE:-}"
required BACKUP_IMAGE "${BACKUP_IMAGE:-}"
required POSTGRES_IMAGE "${POSTGRES_IMAGE:-}"
required CADDY_IMAGE "${CADDY_IMAGE:-}"
required POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-}"
required CRM_APP_PASSWORD "${CRM_APP_PASSWORD:-}"
required BETTER_AUTH_SECRET "${BETTER_AUTH_SECRET:-}"
required PLATFORM_MASTER_EMAIL "${PLATFORM_MASTER_EMAIL:-}"
required PLATFORM_MASTER_PASSWORD "${PLATFORM_MASTER_PASSWORD:-}"
required DEPLOYMENT_ID "${DEPLOYMENT_ID:-}"
required AGENT_WEB_SECRET "${AGENT_WEB_SECRET:-}"
required APPLICATION_VERSION "${APPLICATION_VERSION:-}"
required MIGRATION_VERSION "${MIGRATION_VERSION:-}"
required VENDOR_ENTITLEMENT_TRUST_SET "${VENDOR_ENTITLEMENT_TRUST_SET:-}"
required BACKUP_MARKER_FILE "${BACKUP_MARKER_FILE:-}"
required DEPLOYMENT_RECORD_FILE "${DEPLOYMENT_RECORD_FILE:-}"

for secret_pair in \
  "POSTGRES_PASSWORD:$POSTGRES_PASSWORD" \
  "CRM_APP_PASSWORD:$CRM_APP_PASSWORD" \
  "BETTER_AUTH_SECRET:$BETTER_AUTH_SECRET" \
  "PLATFORM_MASTER_PASSWORD:$PLATFORM_MASTER_PASSWORD" \
  "DEPLOYMENT_ID:$DEPLOYMENT_ID" \
  "AGENT_WEB_SECRET:$AGENT_WEB_SECRET" \
  "VENDOR_ENTITLEMENT_TRUST_SET:$VENDOR_ENTITLEMENT_TRUST_SET"; do
  secret_name=${secret_pair%%:*}
  secret_value=${secret_pair#*:}
  reject_placeholder "$secret_name" "$secret_value"
done

printf '%s\n' "$COMPOSE_PROJECT_NAME" | grep -Eq '^[a-z0-9][a-z0-9_-]*$' ||
  fail "COMPOSE_PROJECT_NAME contains unsupported characters"
printf '%s\n' "$RELEASE_TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$' ||
  fail "RELEASE_TAG must be an immutable release tag such as v1.2.3"

validate_digest_image WEB_IMAGE "$WEB_IMAGE"
validate_digest_image MIGRATOR_IMAGE "$MIGRATOR_IMAGE"
validate_digest_image BACKUP_IMAGE "$BACKUP_IMAGE"
validate_digest_image POSTGRES_IMAGE "$POSTGRES_IMAGE"
validate_digest_image CADDY_IMAGE "$CADDY_IMAGE"

case "$WEB_IMAGE" in ghcr.io/quandatics-malaysia/*) ;; *) fail "WEB_IMAGE must use vendor registry namespace" ;; esac
case "$MIGRATOR_IMAGE" in ghcr.io/quandatics-malaysia/*) ;; *) fail "MIGRATOR_IMAGE must use vendor registry namespace" ;; esac
case "$BACKUP_IMAGE" in ghcr.io/quandatics-malaysia/*) ;; *) fail "BACKUP_IMAGE must use vendor registry namespace" ;; esac

BACKUP_MAX_AGE_SECONDS=${BACKUP_MAX_AGE_SECONDS:-86400}
HEALTHCHECK_ATTEMPTS=${HEALTHCHECK_ATTEMPTS:-30}
HEALTHCHECK_INTERVAL_SECONDS=${HEALTHCHECK_INTERVAL_SECONDS:-2}
HEALTHCHECK_TIMEOUT_SECONDS=${HEALTHCHECK_TIMEOUT_SECONDS:-5}
DB_HEALTH_ATTEMPTS=${DB_HEALTH_ATTEMPTS:-30}
DB_HEALTH_INTERVAL_SECONDS=${DB_HEALTH_INTERVAL_SECONDS:-2}
export BACKUP_MAX_AGE_SECONDS HEALTHCHECK_ATTEMPTS HEALTHCHECK_INTERVAL_SECONDS
export HEALTHCHECK_TIMEOUT_SECONDS DB_HEALTH_ATTEMPTS DB_HEALTH_INTERVAL_SECONDS

validate_positive_integer BACKUP_MAX_AGE_SECONDS "$BACKUP_MAX_AGE_SECONDS"
validate_positive_integer HEALTHCHECK_ATTEMPTS "$HEALTHCHECK_ATTEMPTS"
validate_non_negative_integer HEALTHCHECK_INTERVAL_SECONDS "$HEALTHCHECK_INTERVAL_SECONDS"
validate_positive_integer HEALTHCHECK_TIMEOUT_SECONDS "$HEALTHCHECK_TIMEOUT_SECONDS"
validate_positive_integer DB_HEALTH_ATTEMPTS "$DB_HEALTH_ATTEMPTS"
validate_non_negative_integer DB_HEALTH_INTERVAL_SECONDS "$DB_HEALTH_INTERVAL_SECONDS"

case "$BACKUP_MARKER_FILE" in /*) ;; *) fail "BACKUP_MARKER_FILE must be an absolute path" ;; esac
case "$DEPLOYMENT_RECORD_FILE" in /*) ;; *) fail "DEPLOYMENT_RECORD_FILE must be an absolute path" ;; esac
record_dir=$(dirname "$DEPLOYMENT_RECORD_FILE")
[ -d "$record_dir" ] && [ -w "$record_dir" ] ||
  fail "DEPLOYMENT_RECORD_FILE parent directory must already exist and be writable"
case "${HEALTHCHECK_URL:-http://127.0.0.1:8081/api/health}" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) fail "HEALTHCHECK_URL must target the local client gateway" ;;
esac

command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v awk >/dev/null 2>&1 || fail "awk is required"

docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
compose config --quiet || fail "Compose configuration is invalid"

if ! "$script_dir/verify-images.sh"; then
  fail "image signature verification failed; running containers were not changed"
fi

[ -f "$BACKUP_MARKER_FILE" ] || fail "verified backup marker not found: $BACKUP_MARKER_FILE"
[ -r "$BACKUP_MARKER_FILE" ] || fail "verified backup marker is not readable: $BACKUP_MARKER_FILE"

assert_marker_equal RELEASE_TAG "$RELEASE_TAG"
assert_marker_equal WEB_IMAGE "$WEB_IMAGE"
assert_marker_equal MIGRATOR_IMAGE "$MIGRATOR_IMAGE"
assert_marker_equal BACKUP_IMAGE "$BACKUP_IMAGE"
assert_marker_equal CHECKSUM_VERIFIED true
assert_marker_equal RESTORE_VERIFIED true
assert_marker_equal UPLOAD_VERIFIED true

dump_sha256=$(marker_value DUMP_SHA256)
printf '%s\n' "$dump_sha256" | grep -Eq '^[0-9a-f]{64}$' ||
  fail "backup marker DUMP_SHA256 is missing or invalid"

created_at=$(marker_value CREATED_AT_EPOCH)
printf '%s\n' "$created_at" | grep -Eq '^[0-9]{10}$' ||
  fail "backup marker CREATED_AT_EPOCH is missing or invalid"
now=$(date +%s)
backup_age=$((now - created_at))
[ "$backup_age" -ge 0 ] || fail "verified backup marker timestamp is in the future"
[ "$backup_age" -le "$BACKUP_MAX_AGE_SECONDS" ] || fail "verified backup marker is stale"

if ! compose pull db migrate web backup gateway; then
  fail "image pull failed; running containers were not changed"
fi

compose up -d --no-deps db || fail "database start failed"

db_attempt=1
while [ "$db_attempt" -le "$DB_HEALTH_ATTEMPTS" ]; do
  if compose exec -T db pg_isready -U postgres -d crm >/dev/null 2>&1; then
    break
  fi
  if [ "$db_attempt" -eq "$DB_HEALTH_ATTEMPTS" ]; then
    fail "database health check failed"
  fi
  sleep "$DB_HEALTH_INTERVAL_SECONDS"
  db_attempt=$((db_attempt + 1))
done

compose run --rm --no-deps migrate || fail "migration failed"
compose up -d --no-deps --force-recreate web backup gateway || fail "runtime service recreation failed"

"$script_dir/healthcheck.sh" || fail "health check failed; release was not recorded"

umask 077
record_tmp=$(mktemp "$DEPLOYMENT_RECORD_FILE.XXXXXX")
{
  printf 'RELEASE_TAG=%s\n' "$RELEASE_TAG"
  printf 'WEB_IMAGE=%s\n' "$WEB_IMAGE"
  printf 'MIGRATOR_IMAGE=%s\n' "$MIGRATOR_IMAGE"
  printf 'BACKUP_IMAGE=%s\n' "$BACKUP_IMAGE"
  printf 'POSTGRES_IMAGE=%s\n' "$POSTGRES_IMAGE"
  printf 'CADDY_IMAGE=%s\n' "$CADDY_IMAGE"
  printf 'BACKUP_DUMP_SHA256=%s\n' "$dump_sha256"
  printf 'DEPLOYED_AT_EPOCH=%s\n' "$(date +%s)"
} >"$record_tmp"
chmod 0600 "$record_tmp"
mv -f "$record_tmp" "$DEPLOYMENT_RECORD_FILE"
record_tmp=

echo "deployed and recorded $RELEASE_TAG"
