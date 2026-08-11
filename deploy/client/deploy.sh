#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
compose_file="$script_dir/compose.yaml"
env_file=${1:-$script_dir/.env}
temp_dir=
record_tmp=
lock_dir=
lock_held=0

cleanup() {
  [ -z "$record_tmp" ] || rm -f "$record_tmp"
  if [ "$lock_held" -eq 1 ]; then
    rm -f "$lock_dir/pid"
    rmdir "$lock_dir" 2>/dev/null || true
  fi
  [ -z "$temp_dir" ] || rm -rf "$temp_dir"
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
    *CHANGE_ME*|*change-me*|*changeme*|*REPLACE_ME*|*replace-me*|DERIVED_BY_DEPLOY)
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

validate_port() {
  variable_name=$1
  variable_value=$2
  validate_positive_integer "$variable_name" "$variable_value"
  [ "${#variable_value}" -le 5 ] || fail "$variable_name must be between 1 and 65535"
  [ "$variable_value" -le 65535 ] || fail "$variable_name must be between 1 and 65535"
}

validate_memory_limit() {
  variable_name=$1
  variable_value=$2
  printf '%s\n' "$variable_value" | grep -Eq '^[1-9][0-9]*([.][0-9]+)?([bkmg]i?b?)?$' ||
    fail "$variable_name must be a valid Compose memory limit"
}

stat_uid() {
  if stat -f '%u' "$1" >/dev/null 2>&1; then
    stat -f '%u' "$1"
  else
    stat -c '%u' "$1"
  fi
}

stat_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

assert_secure_file() {
  secure_path=$1
  secure_label=$2
  [ ! -L "$secure_path" ] || fail "$secure_label must not be a symlink"
  [ -f "$secure_path" ] || fail "$secure_label not found: $secure_path"
  [ -r "$secure_path" ] || fail "$secure_label is not readable: $secure_path"
  [ "$(stat_uid "$secure_path")" = "$(id -u)" ] || fail "$secure_label must be owned by the deployment user"
  [ "$(stat_mode "$secure_path")" = 600 ] || fail "$secure_label must have mode 0600"
}

assert_secure_directory() {
  secure_path=$1
  secure_label=$2
  [ ! -L "$secure_path" ] || fail "$secure_label must not be a symlink"
  [ -d "$secure_path" ] || fail "$secure_label must already exist"
  [ "$(stat_uid "$secure_path")" = "$(id -u)" ] || fail "$secure_label must be owned by the deployment user"
  [ "$(stat_mode "$secure_path")" = 700 ] || fail "$secure_label must have mode 0700"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

urlencode() {
  printf '%s' "$1" | jq -sRr '@uri'
}

validate_exact_image() {
  variable_name=$1
  image_reference=$2
  exact_repository=$3
  case "$image_reference" in
    "$exact_repository"@sha256:*) ;;
    *) fail "$variable_name must use exact repository $exact_repository" ;;
  esac
  digest=${image_reference#*@sha256:}
  printf '%s\n' "$digest" | grep -Eq '^[0-9a-f]{64}$' ||
    fail "$variable_name must be an immutable sha256 digest reference"
}

parse_environment() {
  parsed_file=$1
  seen_keys='|'
  line_number=0
  while IFS= read -r line || [ -n "$line" ]; do
    line_number=$((line_number + 1))
    case "$line" in
      ''|'#'*) continue ;;
      *=*) ;;
      *) fail "invalid environment data on line $line_number" ;;
    esac
    key=${line%%=*}
    value=${line#*=}
    case "$seen_keys" in
      *"|$key|"*) fail "duplicate environment key: $key" ;;
    esac
    seen_keys="$seen_keys$key|"
    case "$key" in
      COMPOSE_PROJECT_NAME) COMPOSE_PROJECT_NAME=$value ;;
      RELEASE_TAG) RELEASE_TAG=$value ;;
      SOURCE_COMMIT_SHA) SOURCE_COMMIT_SHA=$value ;;
      WEB_IMAGE) WEB_IMAGE=$value ;;
      MIGRATOR_IMAGE) MIGRATOR_IMAGE=$value ;;
      BACKUP_IMAGE) BACKUP_IMAGE=$value ;;
      POSTGRES_IMAGE) POSTGRES_IMAGE=$value ;;
      CADDY_IMAGE) CADDY_IMAGE=$value ;;
      POSTGRES_PASSWORD) POSTGRES_PASSWORD=$value ;;
      CRM_APP_PASSWORD) CRM_APP_PASSWORD=$value ;;
      BETTER_AUTH_SECRET) BETTER_AUTH_SECRET=$value ;;
      BETTER_AUTH_URL) BETTER_AUTH_URL=$value ;;
      APP_URL) APP_URL=$value ;;
      PLATFORM_MASTER_EMAIL) PLATFORM_MASTER_EMAIL=$value ;;
      PLATFORM_MASTER_PASSWORD) PLATFORM_MASTER_PASSWORD=$value ;;
      BOOTSTRAP_OWNER_EMAIL) BOOTSTRAP_OWNER_EMAIL=$value ;;
      DEPLOYMENT_ID) DEPLOYMENT_ID=$value ;;
      STORAGE_ID) STORAGE_ID=$value ;;
      DB_NAME) DB_NAME=$value ;;
      AGENT_WEB_SECRET) AGENT_WEB_SECRET=$value ;;
      APPLICATION_VERSION) APPLICATION_VERSION=$value ;;
      MIGRATION_VERSION) MIGRATION_VERSION=$value ;;
      VENDOR_ENTITLEMENT_TRUST_SET) VENDOR_ENTITLEMENT_TRUST_SET=$value ;;
      MICROSOFT_CLIENT_ID) MICROSOFT_CLIENT_ID=$value ;;
      MICROSOFT_CLIENT_SECRET) MICROSOFT_CLIENT_SECRET=$value ;;
      MICROSOFT_TENANT_ID) MICROSOFT_TENANT_ID=$value ;;
      DEMO_MODE) DEMO_MODE=$value ;;
      DEMO_TENANT_ID) DEMO_TENANT_ID=$value ;;
      DEMO_TENANT_NAME) DEMO_TENANT_NAME=$value ;;
      DEMO_CURRENCY) DEMO_CURRENCY=$value ;;
      DEMO_TAX_NAME) DEMO_TAX_NAME=$value ;;
      DEMO_TAX_RATE) DEMO_TAX_RATE=$value ;;
      BACKUP_RSYNC_TARGET) BACKUP_RSYNC_TARGET=$value ;;
      BACKUP_EVIDENCE_FILE) BACKUP_EVIDENCE_FILE=$value ;;
      BACKUP_EVIDENCE_SIGNATURE_FILE) BACKUP_EVIDENCE_SIGNATURE_FILE=$value ;;
      BACKUP_EVIDENCE_PUBLIC_KEY_FILE) BACKUP_EVIDENCE_PUBLIC_KEY_FILE=$value ;;
      BACKUP_EVIDENCE_PUBLIC_KEY_SHA256) BACKUP_EVIDENCE_PUBLIC_KEY_SHA256=$value ;;
      BACKUP_MAX_AGE_SECONDS) BACKUP_MAX_AGE_SECONDS=$value ;;
      DEPLOYMENT_RECORD_FILE) DEPLOYMENT_RECORD_FILE=$value ;;
      GATEWAY_HOST_PORT) GATEWAY_HOST_PORT=$value ;;
      DB_HOST_PORT) DB_HOST_PORT=$value ;;
      HEALTHCHECK_ATTEMPTS) HEALTHCHECK_ATTEMPTS=$value ;;
      HEALTHCHECK_INTERVAL_SECONDS) HEALTHCHECK_INTERVAL_SECONDS=$value ;;
      HEALTHCHECK_TIMEOUT_SECONDS) HEALTHCHECK_TIMEOUT_SECONDS=$value ;;
      DB_HEALTH_ATTEMPTS) DB_HEALTH_ATTEMPTS=$value ;;
      DB_HEALTH_INTERVAL_SECONDS) DB_HEALTH_INTERVAL_SECONDS=$value ;;
      DB_MEMORY_LIMIT) DB_MEMORY_LIMIT=$value ;;
      WEB_MEMORY_LIMIT) WEB_MEMORY_LIMIT=$value ;;
      BACKUP_MEMORY_LIMIT) BACKUP_MEMORY_LIMIT=$value ;;
      GATEWAY_MEMORY_LIMIT) GATEWAY_MEMORY_LIMIT=$value ;;
      DATABASE_ADMIN_URL|MIGRATOR_DATABASE_URL|APP_DATABASE_URL) : ;;
      *) fail "unsupported environment key: $key" ;;
    esac
  done <"$parsed_file"
}

parse_evidence() {
  parsed_file=$1
  seen_keys='|'
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *=*) ;;
      *) fail "invalid backup evidence data" ;;
    esac
    key=${line%%=*}
    value=${line#*=}
    case "$seen_keys" in
      *"|$key|"*) fail "duplicate backup evidence key: $key" ;;
    esac
    seen_keys="$seen_keys$key|"
    case "$key" in
      EVIDENCE_VERSION) EVIDENCE_VERSION=$value ;;
      DEPLOYMENT_ID) EVIDENCE_DEPLOYMENT_ID=$value ;;
      COMPOSE_PROJECT_NAME) EVIDENCE_COMPOSE_PROJECT_NAME=$value ;;
      DB_NAME) EVIDENCE_DB_NAME=$value ;;
      STORAGE_ID) EVIDENCE_STORAGE_ID=$value ;;
      POSTGRES_IMAGE) EVIDENCE_POSTGRES_IMAGE=$value ;;
      RELEASE_TAG) EVIDENCE_RELEASE_TAG=$value ;;
      WEB_IMAGE) EVIDENCE_WEB_IMAGE=$value ;;
      MIGRATOR_IMAGE) EVIDENCE_MIGRATOR_IMAGE=$value ;;
      BACKUP_IMAGE) EVIDENCE_BACKUP_IMAGE=$value ;;
      SOURCE_COMMIT_SHA) EVIDENCE_SOURCE_COMMIT_SHA=$value ;;
      CREATED_AT_EPOCH) EVIDENCE_CREATED_AT_EPOCH=$value ;;
      BACKUP_ARTIFACT_FILE) EVIDENCE_BACKUP_ARTIFACT_FILE=$value ;;
      BACKUP_ARTIFACT_SHA256) EVIDENCE_BACKUP_ARTIFACT_SHA256=$value ;;
      CHECKSUM_VERIFIED) EVIDENCE_CHECKSUM_VERIFIED=$value ;;
      RESTORE_VERIFIED) EVIDENCE_RESTORE_VERIFIED=$value ;;
      UPLOAD_VERIFIED) EVIDENCE_UPLOAD_VERIFIED=$value ;;
      *) fail "unsupported backup evidence key: $key" ;;
    esac
  done <"$parsed_file"
}

parse_previous_record() {
  parsed_file=$1
  seen_keys='|'
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *=*) ;;
      *) fail "invalid previous deployment record data" ;;
    esac
    key=${line%%=*}
    value=${line#*=}
    case "$seen_keys" in
      *"|$key|"*) fail "duplicate previous deployment record key: $key" ;;
    esac
    seen_keys="$seen_keys$key|"
    case "$key" in
      RECORD_VERSION) PREVIOUS_RECORD_VERSION=$value ;;
      RELEASE_TAG) PREVIOUS_RELEASE_TAG=$value ;;
      SOURCE_COMMIT_SHA) PREVIOUS_SOURCE_COMMIT_SHA=$value ;;
      DEPLOYMENT_ID) PREVIOUS_DEPLOYMENT_ID=$value ;;
      COMPOSE_PROJECT_NAME) PREVIOUS_COMPOSE_PROJECT_NAME=$value ;;
      DB_NAME) PREVIOUS_DB_NAME=$value ;;
      STORAGE_ID) PREVIOUS_STORAGE_ID=$value ;;
      WEB_IMAGE) PREVIOUS_WEB_IMAGE=$value ;;
      MIGRATOR_IMAGE) PREVIOUS_MIGRATOR_IMAGE=$value ;;
      BACKUP_IMAGE) PREVIOUS_BACKUP_IMAGE=$value ;;
      POSTGRES_IMAGE) PREVIOUS_POSTGRES_IMAGE=$value ;;
      CADDY_IMAGE) PREVIOUS_CADDY_IMAGE=$value ;;
      POSTGRES_PASSWORD) PREVIOUS_POSTGRES_PASSWORD=$value ;;
      CRM_APP_PASSWORD) PREVIOUS_CRM_APP_PASSWORD=$value ;;
      BETTER_AUTH_SECRET) PREVIOUS_BETTER_AUTH_SECRET=$value ;;
      BETTER_AUTH_URL) PREVIOUS_BETTER_AUTH_URL=$value ;;
      APP_URL) PREVIOUS_APP_URL=$value ;;
      BOOTSTRAP_OWNER_EMAIL) PREVIOUS_BOOTSTRAP_OWNER_EMAIL=$value ;;
      AGENT_WEB_SECRET) PREVIOUS_AGENT_WEB_SECRET=$value ;;
      APPLICATION_VERSION) PREVIOUS_APPLICATION_VERSION=$value ;;
      MIGRATION_VERSION) PREVIOUS_MIGRATION_VERSION=$value ;;
      VENDOR_ENTITLEMENT_TRUST_SET) PREVIOUS_VENDOR_ENTITLEMENT_TRUST_SET=$value ;;
      MICROSOFT_CLIENT_ID) PREVIOUS_MICROSOFT_CLIENT_ID=$value ;;
      MICROSOFT_CLIENT_SECRET) PREVIOUS_MICROSOFT_CLIENT_SECRET=$value ;;
      MICROSOFT_TENANT_ID) PREVIOUS_MICROSOFT_TENANT_ID=$value ;;
      DEMO_MODE) PREVIOUS_DEMO_MODE=$value ;;
      DEMO_TENANT_ID) PREVIOUS_DEMO_TENANT_ID=$value ;;
      DEMO_TENANT_NAME) PREVIOUS_DEMO_TENANT_NAME=$value ;;
      DEMO_CURRENCY) PREVIOUS_DEMO_CURRENCY=$value ;;
      DEMO_TAX_NAME) PREVIOUS_DEMO_TAX_NAME=$value ;;
      DEMO_TAX_RATE) PREVIOUS_DEMO_TAX_RATE=$value ;;
      BACKUP_RSYNC_TARGET) PREVIOUS_BACKUP_RSYNC_TARGET=$value ;;
      GATEWAY_HOST_PORT) PREVIOUS_GATEWAY_HOST_PORT=$value ;;
      DB_HOST_PORT) PREVIOUS_DB_HOST_PORT=$value ;;
      DB_MEMORY_LIMIT) PREVIOUS_DB_MEMORY_LIMIT=$value ;;
      WEB_MEMORY_LIMIT) PREVIOUS_WEB_MEMORY_LIMIT=$value ;;
      BACKUP_MEMORY_LIMIT) PREVIOUS_BACKUP_MEMORY_LIMIT=$value ;;
      GATEWAY_MEMORY_LIMIT) PREVIOUS_GATEWAY_MEMORY_LIMIT=$value ;;
      HEALTHCHECK_ATTEMPTS) PREVIOUS_HEALTHCHECK_ATTEMPTS=$value ;;
      HEALTHCHECK_INTERVAL_SECONDS) PREVIOUS_HEALTHCHECK_INTERVAL_SECONDS=$value ;;
      HEALTHCHECK_TIMEOUT_SECONDS) PREVIOUS_HEALTHCHECK_TIMEOUT_SECONDS=$value ;;
      DB_HEALTH_ATTEMPTS) PREVIOUS_DB_HEALTH_ATTEMPTS=$value ;;
      DB_HEALTH_INTERVAL_SECONDS) PREVIOUS_DB_HEALTH_INTERVAL_SECONDS=$value ;;
      BACKUP_ARTIFACT_SHA256) PREVIOUS_BACKUP_ARTIFACT_SHA256=$value ;;
      DEPLOYED_AT_EPOCH) PREVIOUS_DEPLOYED_AT_EPOCH=$value ;;
      *) fail "unsupported previous deployment record key: $key" ;;
    esac
  done <"$parsed_file"
}

assert_evidence_equal() {
  evidence_key=$1
  actual_value=$2
  expected_value=$3
  [ "$actual_value" = "$expected_value" ] || fail "backup evidence $evidence_key does not match intended deployment"
}

compose() (
  export COMPOSE_PROJECT_NAME RELEASE_TAG SOURCE_COMMIT_SHA
  export WEB_IMAGE MIGRATOR_IMAGE BACKUP_IMAGE POSTGRES_IMAGE CADDY_IMAGE
  export POSTGRES_PASSWORD CRM_APP_PASSWORD DB_NAME STORAGE_ID
  export DATABASE_ADMIN_URL MIGRATOR_DATABASE_URL APP_DATABASE_URL
  export BETTER_AUTH_SECRET BETTER_AUTH_URL APP_URL
  export PLATFORM_MASTER_EMAIL PLATFORM_MASTER_PASSWORD BOOTSTRAP_OWNER_EMAIL DEPLOYMENT_ID
  export AGENT_WEB_SECRET APPLICATION_VERSION MIGRATION_VERSION VENDOR_ENTITLEMENT_TRUST_SET
  export MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_TENANT_ID DEMO_MODE
  export DEMO_TENANT_ID DEMO_TENANT_NAME DEMO_CURRENCY DEMO_TAX_NAME DEMO_TAX_RATE
  export BACKUP_RSYNC_TARGET GATEWAY_HOST_PORT DB_HOST_PORT
  export DB_MEMORY_LIMIT WEB_MEMORY_LIMIT BACKUP_MEMORY_LIMIT GATEWAY_MEMORY_LIMIT
  export HEALTHCHECK_ATTEMPTS HEALTHCHECK_INTERVAL_SECONDS HEALTHCHECK_TIMEOUT_SECONDS
  export DB_HEALTH_ATTEMPTS DB_HEALTH_INTERVAL_SECONDS
  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --file "$compose_file" \
    --profile deploy \
    "$@"
)

verify_images() (
  export RELEASE_TAG WEB_IMAGE MIGRATOR_IMAGE BACKUP_IMAGE
  "$script_dir/verify-images.sh"
)

run_healthcheck() (
  export HEALTHCHECK_URL HEALTHCHECK_ATTEMPTS HEALTHCHECK_INTERVAL_SECONDS HEALTHCHECK_TIMEOUT_SECONDS
  "$script_dir/healthcheck.sh"
)

derive_database_urls() {
  encoded_postgres_password=$(urlencode "$POSTGRES_PASSWORD")
  encoded_app_password=$(urlencode "$CRM_APP_PASSWORD")
  DATABASE_ADMIN_URL="postgres://postgres:$encoded_postgres_password@db:5432/$DB_NAME"
  MIGRATOR_DATABASE_URL=$DATABASE_ADMIN_URL
  APP_DATABASE_URL="postgres://crm_app:$encoded_app_password@db:5432/$DB_NAME"
}

derive_healthcheck_url() {
  HEALTHCHECK_URL="http://127.0.0.1:$GATEWAY_HOST_PORT/api/health"
}

restore_target_environment() {
  WEB_IMAGE=$TARGET_WEB_IMAGE
  BACKUP_IMAGE=$TARGET_BACKUP_IMAGE
  POSTGRES_IMAGE=$TARGET_POSTGRES_IMAGE
  CADDY_IMAGE=$TARGET_CADDY_IMAGE
  RELEASE_TAG=$TARGET_RELEASE_TAG
  SOURCE_COMMIT_SHA=$TARGET_SOURCE_COMMIT_SHA
  POSTGRES_PASSWORD=$TARGET_POSTGRES_PASSWORD
  CRM_APP_PASSWORD=$TARGET_CRM_APP_PASSWORD
  BETTER_AUTH_SECRET=$TARGET_BETTER_AUTH_SECRET
  BETTER_AUTH_URL=$TARGET_BETTER_AUTH_URL
  APP_URL=$TARGET_APP_URL
  BOOTSTRAP_OWNER_EMAIL=$TARGET_BOOTSTRAP_OWNER_EMAIL
  AGENT_WEB_SECRET=$TARGET_AGENT_WEB_SECRET
  APPLICATION_VERSION=$TARGET_APPLICATION_VERSION
  MIGRATION_VERSION=$TARGET_MIGRATION_VERSION
  VENDOR_ENTITLEMENT_TRUST_SET=$TARGET_VENDOR_ENTITLEMENT_TRUST_SET
  MICROSOFT_CLIENT_ID=$TARGET_MICROSOFT_CLIENT_ID
  MICROSOFT_CLIENT_SECRET=$TARGET_MICROSOFT_CLIENT_SECRET
  MICROSOFT_TENANT_ID=$TARGET_MICROSOFT_TENANT_ID
  DEMO_MODE=$TARGET_DEMO_MODE
  DEMO_TENANT_ID=$TARGET_DEMO_TENANT_ID
  DEMO_TENANT_NAME=$TARGET_DEMO_TENANT_NAME
  DEMO_CURRENCY=$TARGET_DEMO_CURRENCY
  DEMO_TAX_NAME=$TARGET_DEMO_TAX_NAME
  DEMO_TAX_RATE=$TARGET_DEMO_TAX_RATE
  BACKUP_RSYNC_TARGET=$TARGET_BACKUP_RSYNC_TARGET
  GATEWAY_HOST_PORT=$TARGET_GATEWAY_HOST_PORT
  DB_HOST_PORT=$TARGET_DB_HOST_PORT
  DB_MEMORY_LIMIT=$TARGET_DB_MEMORY_LIMIT
  WEB_MEMORY_LIMIT=$TARGET_WEB_MEMORY_LIMIT
  BACKUP_MEMORY_LIMIT=$TARGET_BACKUP_MEMORY_LIMIT
  GATEWAY_MEMORY_LIMIT=$TARGET_GATEWAY_MEMORY_LIMIT
  HEALTHCHECK_ATTEMPTS=$TARGET_HEALTHCHECK_ATTEMPTS
  HEALTHCHECK_INTERVAL_SECONDS=$TARGET_HEALTHCHECK_INTERVAL_SECONDS
  HEALTHCHECK_TIMEOUT_SECONDS=$TARGET_HEALTHCHECK_TIMEOUT_SECONDS
  DB_HEALTH_ATTEMPTS=$TARGET_DB_HEALTH_ATTEMPTS
  DB_HEALTH_INTERVAL_SECONDS=$TARGET_DB_HEALTH_INTERVAL_SECONDS
  derive_database_urls
  derive_healthcheck_url
}

use_previous_environment() {
  WEB_IMAGE=$PREVIOUS_WEB_IMAGE
  BACKUP_IMAGE=$PREVIOUS_BACKUP_IMAGE
  POSTGRES_IMAGE=$PREVIOUS_POSTGRES_IMAGE
  CADDY_IMAGE=$PREVIOUS_CADDY_IMAGE
  RELEASE_TAG=$PREVIOUS_RELEASE_TAG
  SOURCE_COMMIT_SHA=$PREVIOUS_SOURCE_COMMIT_SHA
  POSTGRES_PASSWORD=$PREVIOUS_POSTGRES_PASSWORD
  CRM_APP_PASSWORD=$PREVIOUS_CRM_APP_PASSWORD
  BETTER_AUTH_SECRET=$PREVIOUS_BETTER_AUTH_SECRET
  BETTER_AUTH_URL=$PREVIOUS_BETTER_AUTH_URL
  APP_URL=$PREVIOUS_APP_URL
  BOOTSTRAP_OWNER_EMAIL=$PREVIOUS_BOOTSTRAP_OWNER_EMAIL
  AGENT_WEB_SECRET=$PREVIOUS_AGENT_WEB_SECRET
  APPLICATION_VERSION=$PREVIOUS_APPLICATION_VERSION
  MIGRATION_VERSION=$PREVIOUS_MIGRATION_VERSION
  VENDOR_ENTITLEMENT_TRUST_SET=$PREVIOUS_VENDOR_ENTITLEMENT_TRUST_SET
  MICROSOFT_CLIENT_ID=$PREVIOUS_MICROSOFT_CLIENT_ID
  MICROSOFT_CLIENT_SECRET=$PREVIOUS_MICROSOFT_CLIENT_SECRET
  MICROSOFT_TENANT_ID=$PREVIOUS_MICROSOFT_TENANT_ID
  DEMO_MODE=$PREVIOUS_DEMO_MODE
  DEMO_TENANT_ID=$PREVIOUS_DEMO_TENANT_ID
  DEMO_TENANT_NAME=$PREVIOUS_DEMO_TENANT_NAME
  DEMO_CURRENCY=$PREVIOUS_DEMO_CURRENCY
  DEMO_TAX_NAME=$PREVIOUS_DEMO_TAX_NAME
  DEMO_TAX_RATE=$PREVIOUS_DEMO_TAX_RATE
  BACKUP_RSYNC_TARGET=$PREVIOUS_BACKUP_RSYNC_TARGET
  GATEWAY_HOST_PORT=$PREVIOUS_GATEWAY_HOST_PORT
  DB_HOST_PORT=$PREVIOUS_DB_HOST_PORT
  DB_MEMORY_LIMIT=$PREVIOUS_DB_MEMORY_LIMIT
  WEB_MEMORY_LIMIT=$PREVIOUS_WEB_MEMORY_LIMIT
  BACKUP_MEMORY_LIMIT=$PREVIOUS_BACKUP_MEMORY_LIMIT
  GATEWAY_MEMORY_LIMIT=$PREVIOUS_GATEWAY_MEMORY_LIMIT
  HEALTHCHECK_ATTEMPTS=$PREVIOUS_HEALTHCHECK_ATTEMPTS
  HEALTHCHECK_INTERVAL_SECONDS=$PREVIOUS_HEALTHCHECK_INTERVAL_SECONDS
  HEALTHCHECK_TIMEOUT_SECONDS=$PREVIOUS_HEALTHCHECK_TIMEOUT_SECONDS
  DB_HEALTH_ATTEMPTS=$PREVIOUS_DB_HEALTH_ATTEMPTS
  DB_HEALTH_INTERVAL_SECONDS=$PREVIOUS_DB_HEALTH_INTERVAL_SECONDS
  derive_database_urls
  derive_healthcheck_url
}

wait_for_database() {
  db_attempt=1
  while [ "$db_attempt" -le "$DB_HEALTH_ATTEMPTS" ]; do
    if compose exec -T db pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1; then
      return 0
    fi
    [ "$db_attempt" -lt "$DB_HEALTH_ATTEMPTS" ] || return 1
    sleep "$DB_HEALTH_INTERVAL_SECONDS"
    db_attempt=$((db_attempt + 1))
  done
  return 1
}

verify_runtime_identity() {
  [ "$(compose exec -T web printenv RELEASE_TAG)" = "$RELEASE_TAG" ] || return 1
  [ "$(compose exec -T web printenv SOURCE_COMMIT_SHA)" = "$SOURCE_COMMIT_SHA" ] || return 1
  [ "$(compose exec -T web printenv APPLICATION_VERSION)" = "$APPLICATION_VERSION" ] || return 1
  [ "$(compose exec -T web printenv MIGRATION_VERSION)" = "$MIGRATION_VERSION" ] || return 1
}

rollback_runtime() {
  [ "$previous_available" -eq 1 ] || return 1
  use_previous_environment
  if ! compose up -d --no-deps --force-recreate web backup gateway; then
    restore_target_environment
    return 1
  fi
  if ! run_healthcheck; then
    restore_target_environment
    return 1
  fi
  if ! verify_runtime_identity; then
    restore_target_environment
    return 1
  fi
  restore_target_environment
  echo "deploy: previous runtime configuration restored and release identity verified" >&2
  return 0
}

rollback_database() {
  [ "$previous_available" -eq 1 ] || return 1
  use_previous_environment
  if ! compose up -d --no-deps --force-recreate db; then
    restore_target_environment
    return 1
  fi
  if ! wait_for_database; then
    restore_target_environment
    return 1
  fi
  restore_target_environment
  echo "deploy: previous database restored and health verified" >&2
  return 0
}

abort_with_database_rollback() {
  failure_reason=$1
  if rollback_database; then
    fail "$failure_reason; previous database restored and health verified"
  fi
  fail "$failure_reason; database rollback failed or no previous deployment record is available"
}

abort_with_rollback() {
  failure_reason=$1
  if rollback_runtime; then
    fail "$failure_reason; previous runtime restored"
  fi
  fail "$failure_reason; rollback failed or no previous deployment record is available"
}

write_deployment_record() {
  umask 077
  record_tmp=$(mktemp "$DEPLOYMENT_RECORD_FILE.XXXXXX") || return 1
  {
    printf 'RECORD_VERSION=2\n'
    printf 'RELEASE_TAG=%s\n' "$RELEASE_TAG"
    printf 'SOURCE_COMMIT_SHA=%s\n' "$SOURCE_COMMIT_SHA"
    printf 'DEPLOYMENT_ID=%s\n' "$DEPLOYMENT_ID"
    printf 'COMPOSE_PROJECT_NAME=%s\n' "$COMPOSE_PROJECT_NAME"
    printf 'DB_NAME=%s\n' "$DB_NAME"
    printf 'STORAGE_ID=%s\n' "$STORAGE_ID"
    printf 'WEB_IMAGE=%s\n' "$WEB_IMAGE"
    printf 'MIGRATOR_IMAGE=%s\n' "$MIGRATOR_IMAGE"
    printf 'BACKUP_IMAGE=%s\n' "$BACKUP_IMAGE"
    printf 'POSTGRES_IMAGE=%s\n' "$POSTGRES_IMAGE"
    printf 'CADDY_IMAGE=%s\n' "$CADDY_IMAGE"
    printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
    printf 'CRM_APP_PASSWORD=%s\n' "$CRM_APP_PASSWORD"
    printf 'BETTER_AUTH_SECRET=%s\n' "$BETTER_AUTH_SECRET"
    printf 'BETTER_AUTH_URL=%s\n' "$BETTER_AUTH_URL"
    printf 'APP_URL=%s\n' "$APP_URL"
    printf 'BOOTSTRAP_OWNER_EMAIL=%s\n' "$BOOTSTRAP_OWNER_EMAIL"
    printf 'AGENT_WEB_SECRET=%s\n' "$AGENT_WEB_SECRET"
    printf 'APPLICATION_VERSION=%s\n' "$APPLICATION_VERSION"
    printf 'MIGRATION_VERSION=%s\n' "$MIGRATION_VERSION"
    printf 'VENDOR_ENTITLEMENT_TRUST_SET=%s\n' "$VENDOR_ENTITLEMENT_TRUST_SET"
    printf 'MICROSOFT_CLIENT_ID=%s\n' "$MICROSOFT_CLIENT_ID"
    printf 'MICROSOFT_CLIENT_SECRET=%s\n' "$MICROSOFT_CLIENT_SECRET"
    printf 'MICROSOFT_TENANT_ID=%s\n' "$MICROSOFT_TENANT_ID"
    printf 'DEMO_MODE=%s\n' "$DEMO_MODE"
    printf 'DEMO_TENANT_ID=%s\n' "$DEMO_TENANT_ID"
    printf 'DEMO_TENANT_NAME=%s\n' "$DEMO_TENANT_NAME"
    printf 'DEMO_CURRENCY=%s\n' "$DEMO_CURRENCY"
    printf 'DEMO_TAX_NAME=%s\n' "$DEMO_TAX_NAME"
    printf 'DEMO_TAX_RATE=%s\n' "$DEMO_TAX_RATE"
    printf 'BACKUP_RSYNC_TARGET=%s\n' "$BACKUP_RSYNC_TARGET"
    printf 'GATEWAY_HOST_PORT=%s\n' "$GATEWAY_HOST_PORT"
    printf 'DB_HOST_PORT=%s\n' "$DB_HOST_PORT"
    printf 'DB_MEMORY_LIMIT=%s\n' "$DB_MEMORY_LIMIT"
    printf 'WEB_MEMORY_LIMIT=%s\n' "$WEB_MEMORY_LIMIT"
    printf 'BACKUP_MEMORY_LIMIT=%s\n' "$BACKUP_MEMORY_LIMIT"
    printf 'GATEWAY_MEMORY_LIMIT=%s\n' "$GATEWAY_MEMORY_LIMIT"
    printf 'HEALTHCHECK_ATTEMPTS=%s\n' "$HEALTHCHECK_ATTEMPTS"
    printf 'HEALTHCHECK_INTERVAL_SECONDS=%s\n' "$HEALTHCHECK_INTERVAL_SECONDS"
    printf 'HEALTHCHECK_TIMEOUT_SECONDS=%s\n' "$HEALTHCHECK_TIMEOUT_SECONDS"
    printf 'DB_HEALTH_ATTEMPTS=%s\n' "$DB_HEALTH_ATTEMPTS"
    printf 'DB_HEALTH_INTERVAL_SECONDS=%s\n' "$DB_HEALTH_INTERVAL_SECONDS"
    printf 'BACKUP_ARTIFACT_SHA256=%s\n' "$EVIDENCE_BACKUP_ARTIFACT_SHA256"
    printf 'DEPLOYED_AT_EPOCH=%s\n' "$(date +%s)"
  } >"$record_tmp" || return 1
  chmod 0600 "$record_tmp" || return 1
  mv -f "$record_tmp" "$DEPLOYMENT_RECORD_FILE" || return 1
  record_tmp=
}

case $# in
  0|1) ;;
  *) fail "usage: deploy.sh [env-file]" ;;
esac

umask 077
temp_dir=$(mktemp -d) || fail "could not create secure temporary directory"
assert_secure_file "$env_file" "environment file"
cp "$env_file" "$temp_dir/environment.env" || fail "could not read environment file"

# Clear every accepted key so ambient variables cannot bypass the data file.
unset COMPOSE_PROJECT_NAME RELEASE_TAG SOURCE_COMMIT_SHA
unset WEB_IMAGE MIGRATOR_IMAGE BACKUP_IMAGE POSTGRES_IMAGE CADDY_IMAGE
unset POSTGRES_PASSWORD CRM_APP_PASSWORD BETTER_AUTH_SECRET BETTER_AUTH_URL APP_URL
unset PLATFORM_MASTER_EMAIL PLATFORM_MASTER_PASSWORD BOOTSTRAP_OWNER_EMAIL
unset DEPLOYMENT_ID STORAGE_ID DB_NAME AGENT_WEB_SECRET APPLICATION_VERSION MIGRATION_VERSION
unset VENDOR_ENTITLEMENT_TRUST_SET MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_TENANT_ID
unset DEMO_MODE DEMO_TENANT_ID DEMO_TENANT_NAME DEMO_CURRENCY DEMO_TAX_NAME DEMO_TAX_RATE
unset BACKUP_RSYNC_TARGET BACKUP_EVIDENCE_FILE BACKUP_EVIDENCE_SIGNATURE_FILE
unset BACKUP_EVIDENCE_PUBLIC_KEY_FILE BACKUP_EVIDENCE_PUBLIC_KEY_SHA256
unset BACKUP_MAX_AGE_SECONDS DEPLOYMENT_RECORD_FILE GATEWAY_HOST_PORT DB_HOST_PORT
unset HEALTHCHECK_ATTEMPTS HEALTHCHECK_INTERVAL_SECONDS HEALTHCHECK_TIMEOUT_SECONDS
unset DB_HEALTH_ATTEMPTS DB_HEALTH_INTERVAL_SECONDS
unset DB_MEMORY_LIMIT WEB_MEMORY_LIMIT BACKUP_MEMORY_LIMIT GATEWAY_MEMORY_LIMIT
COMPOSE_PROJECT_NAME= RELEASE_TAG= SOURCE_COMMIT_SHA=
WEB_IMAGE= MIGRATOR_IMAGE= BACKUP_IMAGE= POSTGRES_IMAGE= CADDY_IMAGE=
POSTGRES_PASSWORD= CRM_APP_PASSWORD= BETTER_AUTH_SECRET= BETTER_AUTH_URL= APP_URL=
PLATFORM_MASTER_EMAIL= PLATFORM_MASTER_PASSWORD= BOOTSTRAP_OWNER_EMAIL=
DEPLOYMENT_ID= STORAGE_ID= DB_NAME= AGENT_WEB_SECRET=
APPLICATION_VERSION= MIGRATION_VERSION= VENDOR_ENTITLEMENT_TRUST_SET=
MICROSOFT_CLIENT_ID= MICROSOFT_CLIENT_SECRET= MICROSOFT_TENANT_ID=
DEMO_MODE= DEMO_TENANT_ID= DEMO_TENANT_NAME= DEMO_CURRENCY= DEMO_TAX_NAME= DEMO_TAX_RATE=
BACKUP_RSYNC_TARGET= BACKUP_EVIDENCE_FILE= BACKUP_EVIDENCE_SIGNATURE_FILE=
BACKUP_EVIDENCE_PUBLIC_KEY_FILE= BACKUP_EVIDENCE_PUBLIC_KEY_SHA256=
BACKUP_MAX_AGE_SECONDS= DEPLOYMENT_RECORD_FILE= GATEWAY_HOST_PORT= DB_HOST_PORT=
HEALTHCHECK_ATTEMPTS= HEALTHCHECK_INTERVAL_SECONDS= HEALTHCHECK_TIMEOUT_SECONDS=
DB_HEALTH_ATTEMPTS= DB_HEALTH_INTERVAL_SECONDS=
DB_MEMORY_LIMIT= WEB_MEMORY_LIMIT= BACKUP_MEMORY_LIMIT= GATEWAY_MEMORY_LIMIT=

parse_environment "$temp_dir/environment.env"

required COMPOSE_PROJECT_NAME "$COMPOSE_PROJECT_NAME"
required RELEASE_TAG "$RELEASE_TAG"
required SOURCE_COMMIT_SHA "$SOURCE_COMMIT_SHA"
required WEB_IMAGE "$WEB_IMAGE"
required MIGRATOR_IMAGE "$MIGRATOR_IMAGE"
required BACKUP_IMAGE "$BACKUP_IMAGE"
required POSTGRES_IMAGE "$POSTGRES_IMAGE"
required CADDY_IMAGE "$CADDY_IMAGE"
required POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
required CRM_APP_PASSWORD "$CRM_APP_PASSWORD"
required BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"
required PLATFORM_MASTER_EMAIL "$PLATFORM_MASTER_EMAIL"
required PLATFORM_MASTER_PASSWORD "$PLATFORM_MASTER_PASSWORD"
required DEPLOYMENT_ID "$DEPLOYMENT_ID"
required STORAGE_ID "$STORAGE_ID"
required DB_NAME "$DB_NAME"
required AGENT_WEB_SECRET "$AGENT_WEB_SECRET"
required APPLICATION_VERSION "$APPLICATION_VERSION"
required MIGRATION_VERSION "$MIGRATION_VERSION"
required VENDOR_ENTITLEMENT_TRUST_SET "$VENDOR_ENTITLEMENT_TRUST_SET"
required BACKUP_EVIDENCE_FILE "$BACKUP_EVIDENCE_FILE"
required BACKUP_EVIDENCE_SIGNATURE_FILE "$BACKUP_EVIDENCE_SIGNATURE_FILE"
required BACKUP_EVIDENCE_PUBLIC_KEY_FILE "$BACKUP_EVIDENCE_PUBLIC_KEY_FILE"
required BACKUP_EVIDENCE_PUBLIC_KEY_SHA256 "$BACKUP_EVIDENCE_PUBLIC_KEY_SHA256"
required DEPLOYMENT_RECORD_FILE "$DEPLOYMENT_RECORD_FILE"

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
printf '%s\n' "$SOURCE_COMMIT_SHA" | grep -Eq '^([0-9a-f]{40}|[0-9a-f]{64})$' ||
  fail "SOURCE_COMMIT_SHA must be a full lowercase Git object ID"
printf '%s\n' "$DB_NAME" | grep -Eq '^[a-z_][a-z0-9_]*$' || fail "DB_NAME is invalid"
printf '%s\n' "$STORAGE_ID" | grep -Eq '^[A-Za-z0-9._-]+$' || fail "STORAGE_ID is invalid"
printf '%s\n' "$BACKUP_EVIDENCE_PUBLIC_KEY_SHA256" | grep -Eq '^[0-9a-f]{64}$' ||
  fail "BACKUP_EVIDENCE_PUBLIC_KEY_SHA256 must be a lowercase sha256 digest"

validate_exact_image WEB_IMAGE "$WEB_IMAGE" ghcr.io/quandatics-malaysia/crm-web
validate_exact_image MIGRATOR_IMAGE "$MIGRATOR_IMAGE" ghcr.io/quandatics-malaysia/crm-migrator
validate_exact_image BACKUP_IMAGE "$BACKUP_IMAGE" ghcr.io/quandatics-malaysia/crm-backup
validate_exact_image POSTGRES_IMAGE "$POSTGRES_IMAGE" docker.io/library/postgres
validate_exact_image CADDY_IMAGE "$CADDY_IMAGE" docker.io/library/caddy

BACKUP_MAX_AGE_SECONDS=${BACKUP_MAX_AGE_SECONDS:-86400}
GATEWAY_HOST_PORT=${GATEWAY_HOST_PORT:-8081}
DB_HOST_PORT=${DB_HOST_PORT:-5433}
HEALTHCHECK_ATTEMPTS=${HEALTHCHECK_ATTEMPTS:-30}
HEALTHCHECK_INTERVAL_SECONDS=${HEALTHCHECK_INTERVAL_SECONDS:-2}
HEALTHCHECK_TIMEOUT_SECONDS=${HEALTHCHECK_TIMEOUT_SECONDS:-5}
DB_HEALTH_ATTEMPTS=${DB_HEALTH_ATTEMPTS:-30}
DB_HEALTH_INTERVAL_SECONDS=${DB_HEALTH_INTERVAL_SECONDS:-2}
BETTER_AUTH_URL=${BETTER_AUTH_URL:-http://localhost}
APP_URL=${APP_URL:-$BETTER_AUTH_URL}
BOOTSTRAP_OWNER_EMAIL=${BOOTSTRAP_OWNER_EMAIL:-}
MICROSOFT_CLIENT_ID=${MICROSOFT_CLIENT_ID:-}
MICROSOFT_CLIENT_SECRET=${MICROSOFT_CLIENT_SECRET:-}
MICROSOFT_TENANT_ID=${MICROSOFT_TENANT_ID:-}
DEMO_MODE=${DEMO_MODE:-false}
DEMO_TENANT_ID=${DEMO_TENANT_ID:-demo-entity}
DEMO_TENANT_NAME=${DEMO_TENANT_NAME:-Demo Workspace}
DEMO_CURRENCY=${DEMO_CURRENCY:-USD}
DEMO_TAX_NAME=${DEMO_TAX_NAME:-VAT 5%}
DEMO_TAX_RATE=${DEMO_TAX_RATE:-5.000}
BACKUP_RSYNC_TARGET=${BACKUP_RSYNC_TARGET:-}
DB_MEMORY_LIMIT=${DB_MEMORY_LIMIT:-2g}
WEB_MEMORY_LIMIT=${WEB_MEMORY_LIMIT:-1g}
BACKUP_MEMORY_LIMIT=${BACKUP_MEMORY_LIMIT:-256m}
GATEWAY_MEMORY_LIMIT=${GATEWAY_MEMORY_LIMIT:-128m}

validate_positive_integer BACKUP_MAX_AGE_SECONDS "$BACKUP_MAX_AGE_SECONDS"
[ "${#BACKUP_MAX_AGE_SECONDS}" -le 9 ] || fail "BACKUP_MAX_AGE_SECONDS is too large"
validate_port GATEWAY_HOST_PORT "$GATEWAY_HOST_PORT"
validate_port DB_HOST_PORT "$DB_HOST_PORT"
validate_memory_limit DB_MEMORY_LIMIT "$DB_MEMORY_LIMIT"
validate_memory_limit WEB_MEMORY_LIMIT "$WEB_MEMORY_LIMIT"
validate_memory_limit BACKUP_MEMORY_LIMIT "$BACKUP_MEMORY_LIMIT"
validate_memory_limit GATEWAY_MEMORY_LIMIT "$GATEWAY_MEMORY_LIMIT"
validate_positive_integer HEALTHCHECK_ATTEMPTS "$HEALTHCHECK_ATTEMPTS"
validate_non_negative_integer HEALTHCHECK_INTERVAL_SECONDS "$HEALTHCHECK_INTERVAL_SECONDS"
validate_positive_integer HEALTHCHECK_TIMEOUT_SECONDS "$HEALTHCHECK_TIMEOUT_SECONDS"
validate_positive_integer DB_HEALTH_ATTEMPTS "$DB_HEALTH_ATTEMPTS"
validate_non_negative_integer DB_HEALTH_INTERVAL_SECONDS "$DB_HEALTH_INTERVAL_SECONDS"

case "$BACKUP_EVIDENCE_FILE" in /*) ;; *) fail "BACKUP_EVIDENCE_FILE must be an absolute path" ;; esac
case "$BACKUP_EVIDENCE_SIGNATURE_FILE" in /*) ;; *) fail "BACKUP_EVIDENCE_SIGNATURE_FILE must be an absolute path" ;; esac
case "$BACKUP_EVIDENCE_PUBLIC_KEY_FILE" in /*) ;; *) fail "BACKUP_EVIDENCE_PUBLIC_KEY_FILE must be an absolute path" ;; esac
case "$DEPLOYMENT_RECORD_FILE" in /*) ;; *) fail "DEPLOYMENT_RECORD_FILE must be an absolute path" ;; esac

record_dir=$(dirname "$DEPLOYMENT_RECORD_FILE")
assert_secure_directory "$record_dir" "deployment record directory"

for required_command in docker curl awk jq openssl stat id cp mktemp; do
  command -v "$required_command" >/dev/null 2>&1 || fail "$required_command is required"
done
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  fail "sha256sum or shasum is required"
fi

derive_database_urls
derive_healthcheck_url

docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
compose config --quiet || fail "Compose configuration is invalid"
verify_images || fail "image signature verification failed; running containers were not changed"

assert_secure_file "$BACKUP_EVIDENCE_PUBLIC_KEY_FILE" "backup evidence public key file"
[ "$(sha256_file "$BACKUP_EVIDENCE_PUBLIC_KEY_FILE")" = "$BACKUP_EVIDENCE_PUBLIC_KEY_SHA256" ] ||
  fail "backup evidence public key does not match pinned sha256"
openssl pkey -pubin -in "$BACKUP_EVIDENCE_PUBLIC_KEY_FILE" -noout >/dev/null 2>&1 ||
  fail "backup evidence public key is invalid"

assert_secure_file "$BACKUP_EVIDENCE_FILE" "backup evidence file"
assert_secure_file "$BACKUP_EVIDENCE_SIGNATURE_FILE" "backup evidence signature file"
cp "$BACKUP_EVIDENCE_FILE" "$temp_dir/backup-evidence.env" || fail "could not read backup evidence"
if ! openssl dgst -sha256 \
  -verify "$BACKUP_EVIDENCE_PUBLIC_KEY_FILE" \
  -signature "$BACKUP_EVIDENCE_SIGNATURE_FILE" \
  "$temp_dir/backup-evidence.env" >/dev/null 2>&1; then
  fail "backup evidence detached signature verification failed"
fi

EVIDENCE_VERSION= EVIDENCE_DEPLOYMENT_ID= EVIDENCE_COMPOSE_PROJECT_NAME=
EVIDENCE_DB_NAME= EVIDENCE_STORAGE_ID= EVIDENCE_POSTGRES_IMAGE=
EVIDENCE_RELEASE_TAG= EVIDENCE_WEB_IMAGE= EVIDENCE_MIGRATOR_IMAGE= EVIDENCE_BACKUP_IMAGE=
EVIDENCE_SOURCE_COMMIT_SHA= EVIDENCE_CREATED_AT_EPOCH=
EVIDENCE_BACKUP_ARTIFACT_FILE= EVIDENCE_BACKUP_ARTIFACT_SHA256=
EVIDENCE_CHECKSUM_VERIFIED= EVIDENCE_RESTORE_VERIFIED= EVIDENCE_UPLOAD_VERIFIED=
parse_evidence "$temp_dir/backup-evidence.env"

assert_evidence_equal EVIDENCE_VERSION "$EVIDENCE_VERSION" 1
assert_evidence_equal DEPLOYMENT_ID "$EVIDENCE_DEPLOYMENT_ID" "$DEPLOYMENT_ID"
assert_evidence_equal COMPOSE_PROJECT_NAME "$EVIDENCE_COMPOSE_PROJECT_NAME" "$COMPOSE_PROJECT_NAME"
assert_evidence_equal DB_NAME "$EVIDENCE_DB_NAME" "$DB_NAME"
assert_evidence_equal STORAGE_ID "$EVIDENCE_STORAGE_ID" "$STORAGE_ID"
assert_evidence_equal POSTGRES_IMAGE "$EVIDENCE_POSTGRES_IMAGE" "$POSTGRES_IMAGE"
assert_evidence_equal RELEASE_TAG "$EVIDENCE_RELEASE_TAG" "$RELEASE_TAG"
assert_evidence_equal WEB_IMAGE "$EVIDENCE_WEB_IMAGE" "$WEB_IMAGE"
assert_evidence_equal MIGRATOR_IMAGE "$EVIDENCE_MIGRATOR_IMAGE" "$MIGRATOR_IMAGE"
assert_evidence_equal BACKUP_IMAGE "$EVIDENCE_BACKUP_IMAGE" "$BACKUP_IMAGE"
[ "$EVIDENCE_SOURCE_COMMIT_SHA" = "$SOURCE_COMMIT_SHA" ] ||
  fail "backup evidence SOURCE_COMMIT_SHA does not match intended release"
assert_evidence_equal CHECKSUM_VERIFIED "$EVIDENCE_CHECKSUM_VERIFIED" true
assert_evidence_equal RESTORE_VERIFIED "$EVIDENCE_RESTORE_VERIFIED" true
assert_evidence_equal UPLOAD_VERIFIED "$EVIDENCE_UPLOAD_VERIFIED" true

printf '%s\n' "$EVIDENCE_CREATED_AT_EPOCH" | grep -Eq '^[0-9]{10}$' ||
  fail "backup evidence CREATED_AT_EPOCH is missing or invalid"
printf '%s\n' "$EVIDENCE_BACKUP_ARTIFACT_SHA256" | grep -Eq '^[0-9a-f]{64}$' ||
  fail "backup evidence BACKUP_ARTIFACT_SHA256 is missing or invalid"
case "$EVIDENCE_BACKUP_ARTIFACT_FILE" in /*) ;; *) fail "backup evidence artifact path must be absolute" ;; esac
assert_secure_file "$EVIDENCE_BACKUP_ARTIFACT_FILE" "backup artifact file"
[ "$(sha256_file "$EVIDENCE_BACKUP_ARTIFACT_FILE")" = "$EVIDENCE_BACKUP_ARTIFACT_SHA256" ] ||
  fail "backup artifact checksum does not match signed evidence"

now=$(date +%s)
backup_age=$((now - EVIDENCE_CREATED_AT_EPOCH))
[ "$backup_age" -ge 0 ] || fail "backup evidence timestamp is in the future"
[ "$backup_age" -le "$BACKUP_MAX_AGE_SECONDS" ] || fail "backup evidence is stale"

reverify_backup_before_migration() {
  final_backup_failure=
  if [ -L "$EVIDENCE_BACKUP_ARTIFACT_FILE" ] || [ ! -f "$EVIDENCE_BACKUP_ARTIFACT_FILE" ]; then
    final_backup_failure="backup artifact security changed before migration"
    return 1
  fi
  if [ "$(stat_uid "$EVIDENCE_BACKUP_ARTIFACT_FILE")" != "$(id -u)" ] ||
    [ "$(stat_mode "$EVIDENCE_BACKUP_ARTIFACT_FILE")" != 600 ]; then
    final_backup_failure="backup artifact security changed before migration"
    return 1
  fi
  if [ "$(sha256_file "$EVIDENCE_BACKUP_ARTIFACT_FILE")" != "$EVIDENCE_BACKUP_ARTIFACT_SHA256" ]; then
    final_backup_failure="backup artifact checksum changed before migration"
    return 1
  fi
  recheck_now=$(date +%s)
  recheck_age=$((recheck_now - EVIDENCE_CREATED_AT_EPOCH))
  if [ "$recheck_age" -lt 0 ]; then
    final_backup_failure="backup evidence timestamp moved into the future before migration"
    return 1
  fi
  if [ "$recheck_age" -gt "$BACKUP_MAX_AGE_SECONDS" ]; then
    final_backup_failure="backup evidence became stale before migration"
    return 1
  fi
  return 0
}

previous_available=0
if [ -e "$DEPLOYMENT_RECORD_FILE" ] || [ -L "$DEPLOYMENT_RECORD_FILE" ]; then
  assert_secure_file "$DEPLOYMENT_RECORD_FILE" "previous deployment record"
  cp "$DEPLOYMENT_RECORD_FILE" "$temp_dir/previous-record.env" || fail "could not read previous deployment record"
  PREVIOUS_RECORD_VERSION= PREVIOUS_RELEASE_TAG= PREVIOUS_SOURCE_COMMIT_SHA=
  PREVIOUS_DEPLOYMENT_ID= PREVIOUS_COMPOSE_PROJECT_NAME= PREVIOUS_DB_NAME= PREVIOUS_STORAGE_ID=
  PREVIOUS_WEB_IMAGE= PREVIOUS_MIGRATOR_IMAGE= PREVIOUS_BACKUP_IMAGE=
  PREVIOUS_POSTGRES_IMAGE= PREVIOUS_CADDY_IMAGE= PREVIOUS_BACKUP_ARTIFACT_SHA256=
  PREVIOUS_POSTGRES_PASSWORD= PREVIOUS_CRM_APP_PASSWORD= PREVIOUS_BETTER_AUTH_SECRET=
  PREVIOUS_BETTER_AUTH_URL= PREVIOUS_APP_URL= PREVIOUS_BOOTSTRAP_OWNER_EMAIL=
  PREVIOUS_AGENT_WEB_SECRET= PREVIOUS_APPLICATION_VERSION= PREVIOUS_MIGRATION_VERSION=
  PREVIOUS_VENDOR_ENTITLEMENT_TRUST_SET=
  PREVIOUS_MICROSOFT_CLIENT_ID= PREVIOUS_MICROSOFT_CLIENT_SECRET= PREVIOUS_MICROSOFT_TENANT_ID=
  PREVIOUS_DEMO_MODE= PREVIOUS_DEMO_TENANT_ID= PREVIOUS_DEMO_TENANT_NAME=
  PREVIOUS_DEMO_CURRENCY= PREVIOUS_DEMO_TAX_NAME= PREVIOUS_DEMO_TAX_RATE=
  PREVIOUS_BACKUP_RSYNC_TARGET=
  PREVIOUS_GATEWAY_HOST_PORT= PREVIOUS_DB_HOST_PORT=
  PREVIOUS_DB_MEMORY_LIMIT= PREVIOUS_WEB_MEMORY_LIMIT=
  PREVIOUS_BACKUP_MEMORY_LIMIT= PREVIOUS_GATEWAY_MEMORY_LIMIT=
  PREVIOUS_HEALTHCHECK_ATTEMPTS= PREVIOUS_HEALTHCHECK_INTERVAL_SECONDS=
  PREVIOUS_HEALTHCHECK_TIMEOUT_SECONDS= PREVIOUS_DB_HEALTH_ATTEMPTS=
  PREVIOUS_DB_HEALTH_INTERVAL_SECONDS=
  PREVIOUS_DEPLOYED_AT_EPOCH=
  parse_previous_record "$temp_dir/previous-record.env"
  [ "$PREVIOUS_RECORD_VERSION" = 2 ] || fail "previous deployment record version is invalid; a protected version 2 rollback record is required"
  printf '%s\n' "$PREVIOUS_RELEASE_TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$' ||
    fail "previous deployment record release tag is invalid"
  printf '%s\n' "$PREVIOUS_SOURCE_COMMIT_SHA" | grep -Eq '^([0-9a-f]{40}|[0-9a-f]{64})$' ||
    fail "previous deployment record source object ID is invalid"
  printf '%s\n' "$PREVIOUS_BACKUP_ARTIFACT_SHA256" | grep -Eq '^[0-9a-f]{64}$' ||
    fail "previous deployment record backup checksum is invalid"
  printf '%s\n' "$PREVIOUS_DEPLOYED_AT_EPOCH" | grep -Eq '^[0-9]{10}$' ||
    fail "previous deployment record timestamp is invalid"
  [ "$PREVIOUS_DEPLOYMENT_ID" = "$DEPLOYMENT_ID" ] || fail "previous deployment record belongs to another deployment"
  [ "$PREVIOUS_COMPOSE_PROJECT_NAME" = "$COMPOSE_PROJECT_NAME" ] || fail "previous deployment record belongs to another project"
  [ "$PREVIOUS_DB_NAME" = "$DB_NAME" ] || fail "previous deployment record belongs to another database"
  [ "$PREVIOUS_STORAGE_ID" = "$STORAGE_ID" ] || fail "previous deployment record belongs to another storage identity"
  validate_exact_image PREVIOUS_WEB_IMAGE "$PREVIOUS_WEB_IMAGE" ghcr.io/quandatics-malaysia/crm-web
  validate_exact_image PREVIOUS_MIGRATOR_IMAGE "$PREVIOUS_MIGRATOR_IMAGE" ghcr.io/quandatics-malaysia/crm-migrator
  validate_exact_image PREVIOUS_BACKUP_IMAGE "$PREVIOUS_BACKUP_IMAGE" ghcr.io/quandatics-malaysia/crm-backup
  validate_exact_image PREVIOUS_POSTGRES_IMAGE "$PREVIOUS_POSTGRES_IMAGE" docker.io/library/postgres
  validate_exact_image PREVIOUS_CADDY_IMAGE "$PREVIOUS_CADDY_IMAGE" docker.io/library/caddy
  required PREVIOUS_POSTGRES_PASSWORD "$PREVIOUS_POSTGRES_PASSWORD"
  required PREVIOUS_CRM_APP_PASSWORD "$PREVIOUS_CRM_APP_PASSWORD"
  required PREVIOUS_BETTER_AUTH_SECRET "$PREVIOUS_BETTER_AUTH_SECRET"
  required PREVIOUS_BETTER_AUTH_URL "$PREVIOUS_BETTER_AUTH_URL"
  required PREVIOUS_APP_URL "$PREVIOUS_APP_URL"
  required PREVIOUS_AGENT_WEB_SECRET "$PREVIOUS_AGENT_WEB_SECRET"
  required PREVIOUS_APPLICATION_VERSION "$PREVIOUS_APPLICATION_VERSION"
  required PREVIOUS_MIGRATION_VERSION "$PREVIOUS_MIGRATION_VERSION"
  required PREVIOUS_VENDOR_ENTITLEMENT_TRUST_SET "$PREVIOUS_VENDOR_ENTITLEMENT_TRUST_SET"
  required PREVIOUS_DEMO_MODE "$PREVIOUS_DEMO_MODE"
  required PREVIOUS_DEMO_TENANT_ID "$PREVIOUS_DEMO_TENANT_ID"
  required PREVIOUS_DEMO_TENANT_NAME "$PREVIOUS_DEMO_TENANT_NAME"
  required PREVIOUS_DEMO_CURRENCY "$PREVIOUS_DEMO_CURRENCY"
  required PREVIOUS_DEMO_TAX_NAME "$PREVIOUS_DEMO_TAX_NAME"
  required PREVIOUS_DEMO_TAX_RATE "$PREVIOUS_DEMO_TAX_RATE"
  validate_port PREVIOUS_GATEWAY_HOST_PORT "$PREVIOUS_GATEWAY_HOST_PORT"
  validate_port PREVIOUS_DB_HOST_PORT "$PREVIOUS_DB_HOST_PORT"
  validate_memory_limit PREVIOUS_DB_MEMORY_LIMIT "$PREVIOUS_DB_MEMORY_LIMIT"
  validate_memory_limit PREVIOUS_WEB_MEMORY_LIMIT "$PREVIOUS_WEB_MEMORY_LIMIT"
  validate_memory_limit PREVIOUS_BACKUP_MEMORY_LIMIT "$PREVIOUS_BACKUP_MEMORY_LIMIT"
  validate_memory_limit PREVIOUS_GATEWAY_MEMORY_LIMIT "$PREVIOUS_GATEWAY_MEMORY_LIMIT"
  validate_positive_integer PREVIOUS_HEALTHCHECK_ATTEMPTS "$PREVIOUS_HEALTHCHECK_ATTEMPTS"
  validate_non_negative_integer PREVIOUS_HEALTHCHECK_INTERVAL_SECONDS "$PREVIOUS_HEALTHCHECK_INTERVAL_SECONDS"
  validate_positive_integer PREVIOUS_HEALTHCHECK_TIMEOUT_SECONDS "$PREVIOUS_HEALTHCHECK_TIMEOUT_SECONDS"
  validate_positive_integer PREVIOUS_DB_HEALTH_ATTEMPTS "$PREVIOUS_DB_HEALTH_ATTEMPTS"
  validate_non_negative_integer PREVIOUS_DB_HEALTH_INTERVAL_SECONDS "$PREVIOUS_DB_HEALTH_INTERVAL_SECONDS"
  previous_available=1
fi

TARGET_WEB_IMAGE=$WEB_IMAGE
TARGET_BACKUP_IMAGE=$BACKUP_IMAGE
TARGET_POSTGRES_IMAGE=$POSTGRES_IMAGE
TARGET_CADDY_IMAGE=$CADDY_IMAGE
TARGET_RELEASE_TAG=$RELEASE_TAG
TARGET_SOURCE_COMMIT_SHA=$SOURCE_COMMIT_SHA
TARGET_POSTGRES_PASSWORD=$POSTGRES_PASSWORD
TARGET_CRM_APP_PASSWORD=$CRM_APP_PASSWORD
TARGET_BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
TARGET_BETTER_AUTH_URL=$BETTER_AUTH_URL
TARGET_APP_URL=$APP_URL
TARGET_BOOTSTRAP_OWNER_EMAIL=$BOOTSTRAP_OWNER_EMAIL
TARGET_AGENT_WEB_SECRET=$AGENT_WEB_SECRET
TARGET_APPLICATION_VERSION=$APPLICATION_VERSION
TARGET_MIGRATION_VERSION=$MIGRATION_VERSION
TARGET_VENDOR_ENTITLEMENT_TRUST_SET=$VENDOR_ENTITLEMENT_TRUST_SET
TARGET_MICROSOFT_CLIENT_ID=$MICROSOFT_CLIENT_ID
TARGET_MICROSOFT_CLIENT_SECRET=$MICROSOFT_CLIENT_SECRET
TARGET_MICROSOFT_TENANT_ID=$MICROSOFT_TENANT_ID
TARGET_DEMO_MODE=$DEMO_MODE
TARGET_DEMO_TENANT_ID=$DEMO_TENANT_ID
TARGET_DEMO_TENANT_NAME=$DEMO_TENANT_NAME
TARGET_DEMO_CURRENCY=$DEMO_CURRENCY
TARGET_DEMO_TAX_NAME=$DEMO_TAX_NAME
TARGET_DEMO_TAX_RATE=$DEMO_TAX_RATE
TARGET_BACKUP_RSYNC_TARGET=$BACKUP_RSYNC_TARGET
TARGET_GATEWAY_HOST_PORT=$GATEWAY_HOST_PORT
TARGET_DB_HOST_PORT=$DB_HOST_PORT
TARGET_DB_MEMORY_LIMIT=$DB_MEMORY_LIMIT
TARGET_WEB_MEMORY_LIMIT=$WEB_MEMORY_LIMIT
TARGET_BACKUP_MEMORY_LIMIT=$BACKUP_MEMORY_LIMIT
TARGET_GATEWAY_MEMORY_LIMIT=$GATEWAY_MEMORY_LIMIT
TARGET_HEALTHCHECK_ATTEMPTS=$HEALTHCHECK_ATTEMPTS
TARGET_HEALTHCHECK_INTERVAL_SECONDS=$HEALTHCHECK_INTERVAL_SECONDS
TARGET_HEALTHCHECK_TIMEOUT_SECONDS=$HEALTHCHECK_TIMEOUT_SECONDS
TARGET_DB_HEALTH_ATTEMPTS=$DB_HEALTH_ATTEMPTS
TARGET_DB_HEALTH_INTERVAL_SECONDS=$DB_HEALTH_INTERVAL_SECONDS
lock_dir="$record_dir/.deploy-$COMPOSE_PROJECT_NAME.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  fail "deployment already in progress for project $COMPOSE_PROJECT_NAME"
fi
lock_held=1
chmod 0700 "$lock_dir"
printf '%s\n' "$$" >"$lock_dir/pid"
chmod 0600 "$lock_dir/pid"

if ! compose pull db migrate web backup gateway; then
  fail "image pull failed; running containers were not changed"
fi

if ! compose up -d --no-deps db; then
  abort_with_database_rollback "target database start failed"
fi
if ! wait_for_database; then
  abort_with_database_rollback "target database health check failed"
fi

if ! reverify_backup_before_migration; then
  abort_with_database_rollback "$final_backup_failure"
fi
compose run --rm --no-deps migrate || fail "migration failed"
if ! compose up -d --no-deps --force-recreate web backup gateway; then
  abort_with_rollback "runtime service recreation failed"
fi
if ! run_healthcheck; then
  abort_with_rollback "health check failed"
fi
if ! verify_runtime_identity; then
  abort_with_rollback "runtime release identity check failed"
fi

if ! write_deployment_record; then
  abort_with_rollback "deployment record update failed"
fi

echo "deployed and recorded $RELEASE_TAG"
