#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
bundle_dir="$repo_root/deploy/client"
compose_file="$bundle_dir/compose.yaml"
deploy_script="$bundle_dir/deploy.sh"
failures=0

record_failure() {
  failures=$((failures + 1))
  echo "not ok - $*" >&2
}

assert_contains() {
  file=$1
  expected=$2
  label=$3
  grep -Fq -- "$expected" "$file" || record_failure "$label: expected '$expected'"
}

assert_not_contains() {
  file=$1
  unexpected=$2
  label=$3
  if grep -Fq -- "$unexpected" "$file"; then
    record_failure "$label: found '$unexpected'"
  fi
}

assert_no_runtime_mutation() {
  label=$1
  if grep -Eq ' (pull|up|run)($| )' "$docker_log"; then
    record_failure "$label: reached image pull or runtime mutation"
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

for required_file in compose.yaml Caddyfile .env.example deploy.sh verify-images.sh healthcheck.sh ops/agent-health.sh README.md; do
  [ -f "$bundle_dir/$required_file" ] || record_failure "missing deploy/client/$required_file"
done
[ -f "$repo_root/apps/deployment-agent/Dockerfile" ] || record_failure "missing apps/deployment-agent/Dockerfile"
[ -f "$repo_root/tests/e2e/licensing.spec.ts" ] || record_failure "missing tests/e2e/licensing.spec.ts"

if grep -Eq '^[[:space:]]*build:' "$compose_file"; then
  record_failure "client compose contains build key"
fi

if grep -Eq 'git[[:space:]]+(pull|clone|fetch)|docker[[:space:]]+compose[[:space:]]+(build|down)|compose[[:space:]].*down[[:space:]]+-v' "$bundle_dir"/*.sh; then
  record_failure "client scripts fetch source, build, stop with down, or delete volumes"
fi

for shell_file in "$bundle_dir"/*.sh; do
  sh -n "$shell_file" || record_failure "shell syntax: $shell_file"
done

test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
chmod 0700 "$test_root"
fake_bin="$test_root/bin"
state_dir="$test_root/state"
mkdir -p "$fake_bin" "$state_dir"
chmod 0700 "$state_dir"

docker_log="$test_root/docker.log"
cosign_log="$test_root/cosign.log"
curl_log="$test_root/curl.log"
url_log="$test_root/url.log"
runtime_log="$test_root/runtime.log"
database_log="$test_root/database.log"
env_argv_log="$test_root/env-argv.log"
output_log="$test_root/output.log"
docker_counter="$test_root/docker-counter"
curl_counter="$test_root/curl-counter"
date_counter="$test_root/date-counter"
proxy_touched="$test_root/proxy-touched"

cat >"$fake_bin/docker" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$TEST_DOCKER_LOG"

case " $* " in
  *" pull "*|*" up "*|*" run "*)
    if [ -n "${TEST_EXPECT_LOCK_DIR:-}" ] && [ ! -d "$TEST_EXPECT_LOCK_DIR" ]; then
      echo "mutation attempted without project lock" >&2
      exit 66
    fi
    ;;
esac

case " $* " in
  *" config --quiet "*|*" config --quiet")
    {
      printf 'DATABASE_ADMIN_URL=%s\n' "${DATABASE_ADMIN_URL:-}"
      printf 'MIGRATOR_DATABASE_URL=%s\n' "${MIGRATOR_DATABASE_URL:-}"
      printf 'APP_DATABASE_URL=%s\n' "${APP_DATABASE_URL:-}"
    } >>"$TEST_URL_LOG"
    ;;
  *" pull "*)
    if [ -n "${TEST_PULL_BLOCK_DIR:-}" ] && [ ! -f "$TEST_PULL_BLOCK_DIR/ready" ]; then
      : >"$TEST_PULL_BLOCK_DIR/ready"
      while [ ! -f "$TEST_PULL_BLOCK_DIR/release" ]; do
        sleep 0.05
      done
    fi
    [ "${TEST_DOCKER_FAIL_PULL:-0}" = 1 ] && exit 42
    ;;
  *" up -d --no-deps db "*|*" up -d --no-deps db"|*" up -d --no-deps --force-recreate db "*|*" up -d --no-deps --force-recreate db")
    printf '%s|%s|%s|%s|%s|%s\n' \
      "${POSTGRES_IMAGE:-}" "${APPLICATION_VERSION:-}" "${DB_HOST_PORT:-}" \
      "${DB_MEMORY_LIMIT:-}" "${DB_HEALTH_ATTEMPTS:-}" "${DB_HEALTH_INTERVAL_SECONDS:-}" >>"$TEST_DATABASE_LOG"
    if [ "${TEST_DB_FAIL_TARGET_START:-0}" = 1 ] && [ "${POSTGRES_IMAGE:-}" = "${TEST_TARGET_POSTGRES_IMAGE:-}" ]; then
      exit 54
    fi
    ;;
  *" exec -T db pg_isready "*)
    if [ "${TEST_TAMPER_ARTIFACT_ON_DB_READY:-0}" = 1 ] && [ ! -f "$TEST_TAMPER_ONCE_FILE" ]; then
      printf 'tampered after initial verification\n' >>"$TEST_BACKUP_ARTIFACT"
      : >"$TEST_TAMPER_ONCE_FILE"
    fi
    if [ "${TEST_DB_FAIL_TARGET_HEALTH:-0}" = 1 ] && [ "${POSTGRES_IMAGE:-}" = "${TEST_TARGET_POSTGRES_IMAGE:-}" ]; then
      exit 55
    fi
    ;;
  *" exec -T web printenv APPLICATION_VERSION "*|*" exec -T web printenv APPLICATION_VERSION")
    printf '%s\n' "${APPLICATION_VERSION:-}"
    ;;
  *" exec -T web printenv MIGRATION_VERSION "*|*" exec -T web printenv MIGRATION_VERSION")
    printf '%s\n' "${MIGRATION_VERSION:-}"
    ;;
  *" exec -T web printenv RELEASE_TAG "*|*" exec -T web printenv RELEASE_TAG")
    printf '%s\n' "${RELEASE_TAG:-}"
    ;;
  *" exec -T web printenv SOURCE_COMMIT_SHA "*|*" exec -T web printenv SOURCE_COMMIT_SHA")
    printf '%s\n' "${SOURCE_COMMIT_SHA:-}"
    ;;
  *" exec -T agent printenv AGENT_VERSION "*|*" exec -T agent printenv AGENT_VERSION")
    printf '%s\n' "${AGENT_VERSION:-}"
    ;;
  *" exec -T agent printenv IMAGE_DIGEST "*|*" exec -T agent printenv IMAGE_DIGEST")
    printf '%s\n' "${IMAGE_DIGEST:-}"
    ;;
  *" exec -T agent /usr/local/bin/agent-health "*|*" exec -T agent /usr/local/bin/agent-health")
    if [ "${TEST_AGENT_FAIL_TARGET_HEALTH:-0}" = 1 ] && [ "${AGENT_IMAGE:-}" = "${TEST_TARGET_AGENT_IMAGE:-}" ]; then
      exit 56
    fi
    ;;
  *" up -d --no-deps --force-recreate web backup gateway agent "*|*" up -d --no-deps --force-recreate web backup gateway agent")
    count=0
    [ ! -f "$TEST_DOCKER_COUNTER" ] || count=$(cat "$TEST_DOCKER_COUNTER")
    count=$((count + 1))
    printf '%s\n' "$count" >"$TEST_DOCKER_COUNTER"
    printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n' \
      "$count" "${WEB_IMAGE:-}" "${BACKUP_IMAGE:-}" "${CADDY_IMAGE:-}" "${AGENT_IMAGE:-}" \
      "${APPLICATION_VERSION:-}" "${MIGRATION_VERSION:-}" "${VENDOR_ENTITLEMENT_TRUST_SET:-}" \
      "${BETTER_AUTH_URL:-}" "${APP_URL:-}" "${RELEASE_TAG:-}" \
      "${GATEWAY_HOST_PORT:-}" "${DB_HOST_PORT:-}" "${DB_MEMORY_LIMIT:-}" "${WEB_MEMORY_LIMIT:-}" \
      "${BACKUP_MEMORY_LIMIT:-}" "${GATEWAY_MEMORY_LIMIT:-}" "${HEALTHCHECK_ATTEMPTS:-}" \
      "${HEALTHCHECK_INTERVAL_SECONDS:-}" "${HEALTHCHECK_TIMEOUT_SECONDS:-}" \
      "${CONTROL_PLANE_URL:-}" "${DEPLOYMENT_ENV:-}" "${AGENT_VERSION:-}" \
      "${AGENT_MEMORY_LIMIT:-}" >>"$TEST_RUNTIME_LOG"
    if [ "${TEST_RUNTIME_FAIL_ONCE:-0}" = 1 ] && [ "$count" -eq 1 ]; then
      exit 44
    fi
    ;;
esac
exit 0
EOF

cat >"$fake_bin/env" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$TEST_ENV_ARGV_LOG"
exec /usr/bin/env "$@"
EOF

cat >"$fake_bin/date" <<'EOF'
#!/bin/sh
set -eu
if [ "$*" = '+%s' ] && [ -n "${TEST_DATE_BASE:-}" ]; then
  count=0
  [ ! -f "$TEST_DATE_COUNTER" ] || count=$(cat "$TEST_DATE_COUNTER")
  count=$((count + 1))
  printf '%s\n' "$count" >"$TEST_DATE_COUNTER"
  if [ "$count" -eq 1 ]; then
    printf '%s\n' "$TEST_DATE_BASE"
  else
    printf '%s\n' "$((TEST_DATE_BASE + 2))"
  fi
  exit 0
fi
exec /bin/date "$@"
EOF

cat >"$fake_bin/cosign" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$TEST_COSIGN_LOG"
last_argument=
for argument do
  last_argument=$argument
done
[ -n "${TEST_COSIGN_FAIL_IMAGE:-}" ] && [ "$last_argument" = "$TEST_COSIGN_FAIL_IMAGE" ] && exit 43
exit 0
EOF

cat >"$fake_bin/curl" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$TEST_CURL_LOG"
case "${http_proxy:-}${https_proxy:-}${all_proxy:-}${HTTP_PROXY:-}${HTTPS_PROXY:-}${ALL_PROXY:-}" in
  '') ;;
  *) : >"$TEST_PROXY_TOUCHED" ;;
esac
[ "${1:-}" = "--disable" ] || : >"$TEST_PROXY_TOUCHED"
case " $* " in
  *" --noproxy * "*) ;;
  *) : >"$TEST_PROXY_TOUCHED" ;;
esac
count=0
[ ! -f "$TEST_CURL_COUNTER" ] || count=$(cat "$TEST_CURL_COUNTER")
count=$((count + 1))
printf '%s\n' "$count" >"$TEST_CURL_COUNTER"
[ "$count" -le "${TEST_CURL_FAIL_COUNT:-0}" ] && exit 22
exit 0
EOF

cat >"$fake_bin/stat" <<'EOF'
#!/bin/sh
set -eu
last_argument=
for argument do
  last_argument=$argument
done
if [ -n "${TEST_STAT_WRONG_PATH:-}" ] && [ "$last_argument" = "$TEST_STAT_WRONG_PATH" ]; then
  case "$*" in
    "-f %u "*|"-c %u "*) printf '999999\n'; exit 0 ;;
  esac
fi
exec /usr/bin/stat "$@"
EOF

chmod 0755 "$fake_bin/docker" "$fake_bin/env" "$fake_bin/date" "$fake_bin/cosign" "$fake_bin/curl" "$fake_bin/stat"

private_key="$test_root/backup-evidence-private.pem"
public_key="$test_root/backup-evidence-public.pem"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$private_key" >/dev/null 2>&1
openssl pkey -in "$private_key" -pubout -out "$public_key" >/dev/null 2>&1
chmod 0600 "$private_key" "$public_key"
public_key_sha256=$(sha256_file "$public_key")

artifact_file="$test_root/backup.enc"
evidence_file="$test_root/backup-evidence.env"
signature_file="$test_root/backup-evidence.sig"
record_file="$state_dir/deployed-release.env"
valid_env="$test_root/valid.env"

web_digest=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
migrator_digest=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
backup_digest=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
agent_digest=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
postgres_digest=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
caddy_digest=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
source_sha=1111111111111111111111111111111111111111
web_image="ghcr.io/super-erp/crm-web@sha256:$web_digest"
migrator_image="ghcr.io/super-erp/crm-migrator@sha256:$migrator_digest"
backup_image="ghcr.io/super-erp/crm-backup@sha256:$backup_digest"
agent_image="ghcr.io/super-erp/crm-deployment-agent@sha256:$agent_digest"
postgres_image="docker.io/library/postgres@sha256:$postgres_digest"
caddy_image="docker.io/library/caddy@sha256:$caddy_digest"

old_web_image="ghcr.io/super-erp/crm-web@sha256:1111111111111111111111111111111111111111111111111111111111111111"
old_migrator_image="ghcr.io/super-erp/crm-migrator@sha256:2222222222222222222222222222222222222222222222222222222222222222"
old_backup_image="ghcr.io/super-erp/crm-backup@sha256:3333333333333333333333333333333333333333333333333333333333333333"
old_agent_image="ghcr.io/super-erp/crm-deployment-agent@sha256:6666666666666666666666666666666666666666666666666666666666666666"
old_postgres_image="docker.io/library/postgres@sha256:4444444444444444444444444444444444444444444444444444444444444444"
old_caddy_image="docker.io/library/caddy@sha256:5555555555555555555555555555555555555555555555555555555555555555"
old_application_version=1.1.0
old_migration_version=0068
old_trust_set=old-trust-set
old_better_auth_url=https://old.crm.example.test
old_app_url=https://old.crm.example.test
old_postgres_password=old-postgres-password
old_crm_app_password=old-application-password
old_better_auth_secret=old-better-auth-secret-with-enough-entropy
old_agent_web_secret=CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC
old_control_plane_url=https://old-control.example.test
old_agent_version=0.1.0
old_agent_memory_limit=96m
deployment_id=11111111-1111-4111-8111-111111111111
agent_web_secret=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
old_gateway_host_port=18081
old_db_host_port=15433
old_db_memory_limit=1536m
old_web_memory_limit=768m
old_backup_memory_limit=192m
old_gateway_memory_limit=96m
old_healthcheck_attempts=7
old_healthcheck_interval=0
old_healthcheck_timeout=4
old_db_health_attempts=6
old_db_health_interval=0

cat >"$valid_env" <<EOF
COMPOSE_PROJECT_NAME=quandatics-client-test
RELEASE_TAG=v1.2.3
SOURCE_COMMIT_SHA=$source_sha
WEB_IMAGE=$web_image
MIGRATOR_IMAGE=$migrator_image
BACKUP_IMAGE=$backup_image
AGENT_IMAGE=$agent_image
POSTGRES_IMAGE=$postgres_image
CADDY_IMAGE=$caddy_image
POSTGRES_PASSWORD=test-postgres-password
CRM_APP_PASSWORD=test-application-password
BETTER_AUTH_SECRET=test-better-auth-secret-with-enough-entropy
BETTER_AUTH_URL=https://crm.example.test
APP_URL=https://crm.example.test
PLATFORM_MASTER_EMAIL=owner@example.test
PLATFORM_MASTER_PASSWORD=test-platform-master-password
BOOTSTRAP_OWNER_EMAIL=owner@example.test
DEPLOYMENT_ID=$deployment_id
STORAGE_ID=storage-test
DB_NAME=crm
AGENT_WEB_SECRET=$agent_web_secret
APPLICATION_VERSION=1.2.3
MIGRATION_VERSION=0069
VENDOR_ENTITLEMENT_TRUST_SET=test-trust-set
CONTROL_PLANE_URL=https://control.example.test
DEPLOYMENT_ENV=production
INSTALLATION_TOKEN=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AGENT_VERSION=0.1.0
AGENT_MEMORY_LIMIT=128m
BACKUP_EVIDENCE_FILE=$evidence_file
BACKUP_EVIDENCE_SIGNATURE_FILE=$signature_file
BACKUP_EVIDENCE_PUBLIC_KEY_FILE=$public_key
BACKUP_EVIDENCE_PUBLIC_KEY_SHA256=$public_key_sha256
BACKUP_MAX_AGE_SECONDS=3600
DEPLOYMENT_RECORD_FILE=$record_file
GATEWAY_HOST_PORT=8081
DB_HOST_PORT=5433
HEALTHCHECK_ATTEMPTS=2
HEALTHCHECK_INTERVAL_SECONDS=0
HEALTHCHECK_TIMEOUT_SECONDS=5
DB_HEALTH_ATTEMPTS=2
DB_HEALTH_INTERVAL_SECONDS=0
DB_MEMORY_LIMIT=2g
WEB_MEMORY_LIMIT=1g
BACKUP_MEMORY_LIMIT=256m
GATEWAY_MEMORY_LIMIT=128m
DATABASE_ADMIN_URL=DERIVED_BY_DEPLOY
MIGRATOR_DATABASE_URL=DERIVED_BY_DEPLOY
APP_DATABASE_URL=DERIVED_BY_DEPLOY
EOF
chmod 0600 "$valid_env"

sign_evidence() {
  openssl dgst -sha256 -sign "$private_key" -out "$signature_file" "$evidence_file"
  chmod 0600 "$signature_file"
}

write_evidence() {
  evidence_project=${1:-quandatics-client-test}
  evidence_source=${2:-$source_sha}
  evidence_web=${3:-$web_image}
  evidence_release=${4:-v1.2.3}
  evidence_migrator=${5:-$migrator_image}
  evidence_backup=${6:-$backup_image}
  evidence_postgres=${7:-$postgres_image}
  printf 'encrypted backup bytes\n' >"$artifact_file"
  chmod 0600 "$artifact_file"
  artifact_sha256=$(sha256_file "$artifact_file")
  now=$(date +%s)
  cat >"$evidence_file" <<EOF
EVIDENCE_VERSION=1
DEPLOYMENT_ID=$deployment_id
COMPOSE_PROJECT_NAME=$evidence_project
DB_NAME=crm
STORAGE_ID=storage-test
POSTGRES_IMAGE=$evidence_postgres
RELEASE_TAG=$evidence_release
WEB_IMAGE=$evidence_web
MIGRATOR_IMAGE=$evidence_migrator
BACKUP_IMAGE=$evidence_backup
SOURCE_COMMIT_SHA=$evidence_source
CREATED_AT_EPOCH=$now
BACKUP_ARTIFACT_FILE=$artifact_file
BACKUP_ARTIFACT_SHA256=$artifact_sha256
CHECKSUM_VERIFIED=true
RESTORE_VERIFIED=true
UPLOAD_VERIFIED=true
EOF
  chmod 0600 "$evidence_file"
  sign_evidence
}

write_previous_record() {
  cat >"$record_file" <<EOF
RECORD_VERSION=3
RELEASE_TAG=v1.1.0
SOURCE_COMMIT_SHA=0000000000000000000000000000000000000000
DEPLOYMENT_ID=$deployment_id
COMPOSE_PROJECT_NAME=quandatics-client-test
DB_NAME=crm
STORAGE_ID=storage-test
WEB_IMAGE=$old_web_image
MIGRATOR_IMAGE=$old_migrator_image
BACKUP_IMAGE=$old_backup_image
AGENT_IMAGE=$old_agent_image
POSTGRES_IMAGE=$old_postgres_image
CADDY_IMAGE=$old_caddy_image
POSTGRES_PASSWORD=$old_postgres_password
CRM_APP_PASSWORD=$old_crm_app_password
BETTER_AUTH_SECRET=$old_better_auth_secret
BETTER_AUTH_URL=$old_better_auth_url
APP_URL=$old_app_url
BOOTSTRAP_OWNER_EMAIL=old-owner@example.test
AGENT_WEB_SECRET=$old_agent_web_secret
APPLICATION_VERSION=$old_application_version
MIGRATION_VERSION=$old_migration_version
VENDOR_ENTITLEMENT_TRUST_SET=$old_trust_set
CONTROL_PLANE_URL=$old_control_plane_url
DEPLOYMENT_ENV=production
AGENT_VERSION=$old_agent_version
AGENT_MEMORY_LIMIT=$old_agent_memory_limit
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
DEMO_MODE=false
DEMO_TENANT_ID=old-demo-entity
DEMO_TENANT_NAME=Old Demo Workspace
DEMO_CURRENCY=MYR
DEMO_TAX_NAME=SST
DEMO_TAX_RATE=8.000
BACKUP_RSYNC_TARGET=
GATEWAY_HOST_PORT=$old_gateway_host_port
DB_HOST_PORT=$old_db_host_port
DB_MEMORY_LIMIT=$old_db_memory_limit
WEB_MEMORY_LIMIT=$old_web_memory_limit
BACKUP_MEMORY_LIMIT=$old_backup_memory_limit
GATEWAY_MEMORY_LIMIT=$old_gateway_memory_limit
HEALTHCHECK_ATTEMPTS=$old_healthcheck_attempts
HEALTHCHECK_INTERVAL_SECONDS=$old_healthcheck_interval
HEALTHCHECK_TIMEOUT_SECONDS=$old_healthcheck_timeout
DB_HEALTH_ATTEMPTS=$old_db_health_attempts
DB_HEALTH_INTERVAL_SECONDS=$old_db_health_interval
BACKUP_ARTIFACT_SHA256=9999999999999999999999999999999999999999999999999999999999999999
DEPLOYED_AT_EPOCH=1700000000
EOF
  chmod 0600 "$record_file"
}

reset_logs() {
  : >"$docker_log"
  : >"$cosign_log"
  : >"$curl_log"
  : >"$url_log"
  : >"$runtime_log"
  : >"$database_log"
  : >"$env_argv_log"
  rm -f "$docker_counter" "$curl_counter" "$date_counter" "$proxy_touched" "$test_root/tamper-once"
}

run_deploy() {
  env_file=$1
  output_file=${2:-$output_log}
  PATH="$fake_bin:/usr/bin:/bin:/usr/sbin:/sbin" \
    TEST_DOCKER_LOG="$docker_log" \
    TEST_COSIGN_LOG="$cosign_log" \
    TEST_CURL_LOG="$curl_log" \
    TEST_URL_LOG="$url_log" \
    TEST_RUNTIME_LOG="$runtime_log" \
    TEST_DATABASE_LOG="$database_log" \
    TEST_ENV_ARGV_LOG="$env_argv_log" \
    TEST_DOCKER_COUNTER="$docker_counter" \
    TEST_CURL_COUNTER="$curl_counter" \
    TEST_DATE_COUNTER="$date_counter" \
    TEST_DATE_BASE="${TEST_DATE_BASE:-}" \
    TEST_PROXY_TOUCHED="$proxy_touched" \
    TEST_TAMPER_ARTIFACT_ON_DB_READY="${TEST_TAMPER_ARTIFACT_ON_DB_READY:-0}" \
    TEST_TAMPER_ONCE_FILE="$test_root/tamper-once" \
    TEST_BACKUP_ARTIFACT="$artifact_file" \
    TEST_DB_FAIL_TARGET_HEALTH="${TEST_DB_FAIL_TARGET_HEALTH:-0}" \
    TEST_DB_FAIL_TARGET_START="${TEST_DB_FAIL_TARGET_START:-0}" \
    TEST_TARGET_POSTGRES_IMAGE="$postgres_image" \
    TEST_AGENT_FAIL_TARGET_HEALTH="${TEST_AGENT_FAIL_TARGET_HEALTH:-0}" \
    TEST_TARGET_AGENT_IMAGE="$agent_image" \
    TEST_DOCKER_FAIL_PULL="${TEST_DOCKER_FAIL_PULL:-0}" \
    TEST_COSIGN_FAIL_IMAGE="${TEST_COSIGN_FAIL_IMAGE:-}" \
    TEST_RUNTIME_FAIL_ONCE="${TEST_RUNTIME_FAIL_ONCE:-0}" \
    TEST_CURL_FAIL_COUNT="${TEST_CURL_FAIL_COUNT:-0}" \
    TEST_PULL_BLOCK_DIR="${TEST_PULL_BLOCK_DIR:-}" \
    TEST_STAT_WRONG_PATH="${TEST_STAT_WRONG_PATH:-}" \
    TEST_EXPECT_LOCK_DIR="$state_dir/.deploy-quandatics-client-test.lock" \
    "$deploy_script" "$env_file" >"$output_file" 2>&1
}

expect_deploy_failure() {
  label=$1
  env_file=$2
  expected=$3
  reset_logs
  if run_deploy "$env_file"; then
    record_failure "$label: deploy unexpectedly succeeded"
    return
  fi
  assert_contains "$output_log" "$expected" "$label"
}

copy_env_with_replacement() {
  source_file=$1
  key=$2
  replacement=$3
  destination=$4
  awk -v key="$key" -v replacement="$replacement" '
    index($0, key "=") == 1 { print key "=" replacement; next }
    { print }
  ' "$source_file" >"$destination"
  chmod 0600 "$destination"
}

write_evidence

mode_env="$test_root/mode.env"
cp "$valid_env" "$mode_env"
chmod 0644 "$mode_env"
expect_deploy_failure "insecure env mode" "$mode_env" "environment file must have mode 0600"

symlink_env="$test_root/symlink.env"
ln -s "$valid_env" "$symlink_env"
expect_deploy_failure "symlink env" "$symlink_env" "environment file must not be a symlink"

TEST_STAT_WRONG_PATH=$valid_env
export TEST_STAT_WRONG_PATH
expect_deploy_failure "wrong env owner" "$valid_env" "environment file must be owned by the deployment user"
unset TEST_STAT_WRONG_PATH

unknown_env="$test_root/unknown.env"
cp "$valid_env" "$unknown_env"
printf 'UNAPPROVED_KEY=value\n' >>"$unknown_env"
chmod 0600 "$unknown_env"
expect_deploy_failure "unknown env key" "$unknown_env" "unsupported environment key: UNAPPROVED_KEY"

injection_target="$test_root/env-was-executed"
injection_env="$test_root/injection.env"
copy_env_with_replacement "$valid_env" POSTGRES_PASSWORD "\$(touch $injection_target)" "$injection_env"
reset_logs
rm -f "$record_file" "$injection_target"
if ! run_deploy "$injection_env"; then
  record_failure "data-only env: valid literal failed: $(cat "$output_log")"
fi
[ ! -e "$injection_target" ] || record_failure "data-only env executed command substitution"

reserved_env="$test_root/reserved-password.env"
copy_env_with_replacement "$valid_env" POSTGRES_PASSWORD 'pa:ss@word/?#%$' "$reserved_env"
reset_logs
rm -f "$record_file"
if ! run_deploy "$reserved_env"; then
  record_failure "reserved DB password deploy failed: $(cat "$output_log")"
fi
assert_contains "$url_log" 'DATABASE_ADMIN_URL=postgres://postgres:pa%3Ass%40word%2F%3F%23%25%24@db:5432/crm' "admin URL encoding"
assert_contains "$url_log" 'MIGRATOR_DATABASE_URL=postgres://postgres:pa%3Ass%40word%2F%3F%23%25%24@db:5432/crm' "migrator URL encoding"

write_evidence
chmod 0644 "$evidence_file"
expect_deploy_failure "insecure evidence mode" "$valid_env" "backup evidence file must have mode 0600"
chmod 0600 "$evidence_file"

wrong_key_pin_env="$test_root/wrong-key-pin.env"
copy_env_with_replacement "$valid_env" BACKUP_EVIDENCE_PUBLIC_KEY_SHA256 ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff "$wrong_key_pin_env"
expect_deploy_failure "wrong pinned backup key" "$wrong_key_pin_env" "backup evidence public key does not match pinned sha256"

real_evidence="$test_root/real-evidence.env"
mv "$evidence_file" "$real_evidence"
ln -s "$real_evidence" "$evidence_file"
expect_deploy_failure "symlink evidence" "$valid_env" "backup evidence file must not be a symlink"
rm "$evidence_file"
mv "$real_evidence" "$evidence_file"

write_evidence
chmod 0644 "$signature_file"
expect_deploy_failure "insecure signature mode" "$valid_env" "backup evidence signature file must have mode 0600"
chmod 0600 "$signature_file"

real_signature="$test_root/real-evidence.sig"
mv "$signature_file" "$real_signature"
ln -s "$real_signature" "$signature_file"
expect_deploy_failure "symlink signature" "$valid_env" "backup evidence signature file must not be a symlink"
rm "$signature_file"
mv "$real_signature" "$signature_file"

write_evidence
real_artifact="$test_root/real-backup.enc"
mv "$artifact_file" "$real_artifact"
ln -s "$real_artifact" "$artifact_file"
expect_deploy_failure "symlink backup artifact" "$valid_env" "backup artifact file must not be a symlink"
rm "$artifact_file"
mv "$real_artifact" "$artifact_file"

write_evidence
printf 'invalid signature' >"$signature_file"
chmod 0600 "$signature_file"
expect_deploy_failure "bad evidence signature" "$valid_env" "backup evidence detached signature verification failed"

write_evidence
printf 'tampered\n' >>"$artifact_file"
expect_deploy_failure "tampered backup artifact" "$valid_env" "backup artifact checksum does not match signed evidence"

write_evidence other-project
expect_deploy_failure "cross-project evidence" "$valid_env" "backup evidence COMPOSE_PROJECT_NAME does not match intended deployment"

write_evidence quandatics-client-test 2222222222222222222222222222222222222222
expect_deploy_failure "wrong source provenance" "$valid_env" "backup evidence SOURCE_COMMIT_SHA does not match intended release"

write_evidence
printf 'UNAPPROVED_EVIDENCE=value\n' >>"$evidence_file"
sign_evidence
expect_deploy_failure "unknown evidence key" "$valid_env" "unsupported backup evidence key: UNAPPROVED_EVIDENCE"

write_evidence
wrong_repo_env="$test_root/wrong-repository.env"
copy_env_with_replacement "$valid_env" WEB_IMAGE "ghcr.io/super-erp/crm-web-shadow@sha256:$web_digest" "$wrong_repo_env"
expect_deploy_failure "wrong vendor repository" "$wrong_repo_env" "WEB_IMAGE must use exact repository ghcr.io/super-erp/crm-web"

wrong_upstream_env="$test_root/wrong-upstream.env"
copy_env_with_replacement "$valid_env" POSTGRES_IMAGE "registry.example/postgres@sha256:$postgres_digest" "$wrong_upstream_env"
expect_deploy_failure "wrong upstream repository" "$wrong_upstream_env" "POSTGRES_IMAGE must use exact repository docker.io/library/postgres"

write_evidence
write_previous_record
malformed_record="$test_root/malformed-record.env"
copy_env_with_replacement "$record_file" DB_MEMORY_LIMIT not-a-memory-limit "$malformed_record"
mv "$malformed_record" "$record_file"
expect_deploy_failure "malformed prior Compose memory" "$valid_env" "PREVIOUS_DB_MEMORY_LIMIT must be a valid Compose memory limit"
assert_no_runtime_mutation "malformed prior Compose memory"

write_previous_record
write_evidence quandatics-client-test 0000000000000000000000000000000000000000 "$old_web_image" \
  v1.1.0 "$old_migrator_image" "$old_backup_image" "$old_postgres_image"
reset_logs
if ! run_deploy "$valid_env"; then
  record_failure "previous-release backup evidence deploy failed: $(cat "$output_log")"
fi
assert_contains "$record_file" 'RELEASE_TAG=v1.2.3' "previous-release backup evidence records target"

write_evidence
rm -f "$record_file"
TEST_COSIGN_FAIL_IMAGE=$migrator_image
export TEST_COSIGN_FAIL_IMAGE
expect_deploy_failure "bad image signature" "$valid_env" "image signature verification failed; running containers were not changed"
unset TEST_COSIGN_FAIL_IMAGE
assert_no_runtime_mutation "bad image signature"
[ ! -e "$record_file" ] || record_failure "bad image signature changed the deployment record"

write_evidence
rm -f "$record_file"
TEST_DOCKER_FAIL_PULL=1
export TEST_DOCKER_FAIL_PULL
expect_deploy_failure "failed image pull" "$valid_env" "image pull failed; running containers were not changed"
unset TEST_DOCKER_FAIL_PULL
if grep -Eq ' (up|run)($| )' "$docker_log"; then
  record_failure "failed image pull reached runtime mutation"
fi
[ ! -e "$record_file" ] || record_failure "failed image pull changed the deployment record"
[ ! -d "$state_dir/.deploy-quandatics-client-test.lock" ] || record_failure "failed image pull left the project lock behind"

write_evidence
write_previous_record
evidence_epoch=$(awk -F= '$1 == "CREATED_AT_EPOCH" { print $2 }' "$evidence_file")
freshness_env="$test_root/freshness.env"
copy_env_with_replacement "$valid_env" BACKUP_MAX_AGE_SECONDS 1 "$freshness_env"
TEST_DATE_BASE=$evidence_epoch
export TEST_DATE_BASE
expect_deploy_failure "evidence expires after pull" "$freshness_env" "backup evidence became stale before migration; previous database restored and health verified"
unset TEST_DATE_BASE
assert_contains "$docker_log" " pull db migrate web backup gateway agent" "freshness recheck occurs after pull"
assert_contains "$database_log" "$postgres_image|1.2.3|5433|2g|2|0" "stale evidence target database swap"
assert_contains "$database_log" "$old_postgres_image|$old_application_version|$old_db_host_port|$old_db_memory_limit|$old_db_health_attempts|$old_db_health_interval" "stale evidence previous database restore"
if grep -Eq ' run .* migrate' "$docker_log"; then
  record_failure "stale post-pull evidence reached migrator"
fi
[ ! -s "$runtime_log" ] || record_failure "stale post-pull evidence changed runtime services"
assert_contains "$record_file" 'RELEASE_TAG=v1.1.0' "stale evidence preserves old record"

write_evidence
write_previous_record
TEST_TAMPER_ARTIFACT_ON_DB_READY=1
export TEST_TAMPER_ARTIFACT_ON_DB_READY
expect_deploy_failure "backup artifact changes after pull" "$valid_env" "backup artifact checksum changed before migration; previous database restored and health verified"
unset TEST_TAMPER_ARTIFACT_ON_DB_READY
assert_contains "$database_log" "$postgres_image|1.2.3|5433|2g|2|0" "changed artifact target database swap"
assert_contains "$database_log" "$old_postgres_image|$old_application_version|$old_db_host_port|$old_db_memory_limit|$old_db_health_attempts|$old_db_health_interval" "changed artifact previous database restore"
if grep -Eq ' run .* migrate' "$docker_log"; then
  record_failure "changed post-pull backup artifact reached migrator"
fi
[ ! -s "$runtime_log" ] || record_failure "changed post-pull artifact changed runtime services"
assert_contains "$record_file" 'RELEASE_TAG=v1.1.0' "changed artifact preserves old record"

write_evidence
write_previous_record
TEST_DB_FAIL_TARGET_START=1
export TEST_DB_FAIL_TARGET_START
expect_deploy_failure "target PostgreSQL start failure" "$valid_env" "target database start failed; previous database restored and health verified"
unset TEST_DB_FAIL_TARGET_START
assert_contains "$database_log" "$postgres_image|1.2.3" "failed target PostgreSQL start"
assert_contains "$database_log" "$old_postgres_image|$old_application_version" "previous PostgreSQL restore after start failure"
if grep -Eq ' run .* migrate' "$docker_log"; then
  record_failure "failed target PostgreSQL start reached migrator"
fi
assert_contains "$record_file" 'RELEASE_TAG=v1.1.0' "database start rollback preserves old record"

write_evidence
write_previous_record
TEST_DB_FAIL_TARGET_HEALTH=1
export TEST_DB_FAIL_TARGET_HEALTH
expect_deploy_failure "target PostgreSQL health failure" "$valid_env" "target database health check failed; previous database restored and health verified"
unset TEST_DB_FAIL_TARGET_HEALTH
assert_contains "$database_log" "$postgres_image|1.2.3" "target PostgreSQL start"
assert_contains "$database_log" "$old_postgres_image|$old_application_version" "previous PostgreSQL restore"
if grep -Eq ' run .* migrate' "$docker_log"; then
  record_failure "failed target PostgreSQL health reached migrator"
fi
assert_contains "$record_file" 'RELEASE_TAG=v1.1.0' "database rollback preserves old record"

for invalid_health_url in \
  'http://user@127.0.0.1:8081/api/health' \
  'http://127.0.0.1:abc/api/health' \
  'http://127.0.0.1:8081/api/health?probe=1' \
  'https://127.0.0.1:8081/api/health'; do
  : >"$curl_log"
  rm -f "$curl_counter"
  if PATH="$fake_bin:/usr/bin:/bin" \
    TEST_CURL_LOG="$curl_log" TEST_CURL_COUNTER="$curl_counter" \
    HEALTHCHECK_URL="$invalid_health_url" \
    "$bundle_dir/healthcheck.sh" >"$output_log" 2>&1; then
    record_failure "invalid health URL accepted: $invalid_health_url"
  fi
  [ ! -s "$curl_log" ] || record_failure "invalid health URL reached curl: $invalid_health_url"
done

rm -f "$proxy_touched" "$curl_counter"
if ! PATH="$fake_bin:/usr/bin:/bin" \
  TEST_CURL_LOG="$curl_log" TEST_CURL_COUNTER="$curl_counter" TEST_PROXY_TOUCHED="$proxy_touched" \
  HTTP_PROXY=http://external-proxy.invalid:3128 HTTPS_PROXY=http://external-proxy.invalid:3128 \
  ALL_PROXY=http://external-proxy.invalid:3128 http_proxy=http://external-proxy.invalid:3128 \
  https_proxy=http://external-proxy.invalid:3128 all_proxy=http://external-proxy.invalid:3128 \
  CURL_HOME="$test_root/curl-home" \
  HEALTHCHECK_URL=http://127.0.0.1:8081/api/health \
  HEALTHCHECK_ATTEMPTS=1 HEALTHCHECK_INTERVAL_SECONDS=0 HEALTHCHECK_TIMEOUT_SECONDS=1 \
  "$bundle_dir/healthcheck.sh" >"$output_log" 2>&1; then
  record_failure "proxy-isolated loopback health check failed"
fi
[ ! -e "$proxy_touched" ] || record_failure "health check exposed loopback request to proxy/config handling"

write_evidence
write_previous_record
reset_logs
TEST_RUNTIME_FAIL_ONCE=1
export TEST_RUNTIME_FAIL_ONCE
if run_deploy "$valid_env"; then
  record_failure "partial recreate failure unexpectedly succeeded"
else
  assert_contains "$output_log" "previous runtime restored" "partial recreate rollback"
fi
unset TEST_RUNTIME_FAIL_ONCE
assert_contains "$runtime_log" "1|$web_image|$backup_image|$caddy_image|$agent_image" "target runtime recreate attempt"
assert_contains "$runtime_log" "2|$old_web_image|$old_backup_image|$old_caddy_image|$old_agent_image" "partial recreate rollback refs"
assert_contains "$runtime_log" "2|$old_web_image|$old_backup_image|$old_caddy_image|$old_agent_image|$old_application_version|$old_migration_version|$old_trust_set|$old_better_auth_url|$old_app_url|v1.1.0" "partial recreate rollback config"
assert_contains "$runtime_log" "|v1.1.0|$old_gateway_host_port|$old_db_host_port|$old_db_memory_limit|$old_web_memory_limit|$old_backup_memory_limit|$old_gateway_memory_limit|$old_healthcheck_attempts|$old_healthcheck_interval|$old_healthcheck_timeout" "partial recreate rollback host/resource/health config"
assert_contains "$docker_log" "exec -T web printenv RELEASE_TAG" "restored release identity verification"
assert_contains "$curl_log" "http://127.0.0.1:$old_gateway_host_port/api/health" "restored Nginx-reachable health port"
assert_contains "$record_file" 'RELEASE_TAG=v1.1.0' "partial recreate preserves old record"

write_evidence
write_previous_record
reset_logs
TEST_CURL_FAIL_COUNT=2
export TEST_CURL_FAIL_COUNT
if run_deploy "$valid_env"; then
  record_failure "new runtime health failure unexpectedly succeeded"
else
  assert_contains "$output_log" "previous runtime restored" "health rollback"
fi
unset TEST_CURL_FAIL_COUNT
assert_contains "$runtime_log" "2|$old_web_image|$old_backup_image|$old_caddy_image|$old_agent_image" "health rollback refs"
assert_contains "$runtime_log" "2|$old_web_image|$old_backup_image|$old_caddy_image|$old_agent_image|$old_application_version|$old_migration_version|$old_trust_set|$old_better_auth_url|$old_app_url|v1.1.0" "health rollback config"
assert_contains "$runtime_log" "|v1.1.0|$old_gateway_host_port|$old_db_host_port|$old_db_memory_limit|$old_web_memory_limit|$old_backup_memory_limit|$old_gateway_memory_limit|$old_healthcheck_attempts|$old_healthcheck_interval|$old_healthcheck_timeout" "health rollback host/resource/health config"
assert_contains "$curl_log" "http://127.0.0.1:$old_gateway_host_port/api/health" "health rollback uses restored gateway port"
[ "$(wc -l <"$curl_log" | tr -d ' ')" -eq 3 ] || record_failure "rollback did not exhaust new health and verify restored health"
assert_contains "$record_file" 'RELEASE_TAG=v1.1.0' "health rollback preserves old record"

write_evidence
write_previous_record
reset_logs
TEST_AGENT_FAIL_TARGET_HEALTH=1
export TEST_AGENT_FAIL_TARGET_HEALTH
expect_deploy_failure "agent entitlement health failure" "$valid_env" "deployment agent did not apply a valid entitlement; previous runtime restored"
unset TEST_AGENT_FAIL_TARGET_HEALTH
assert_contains "$runtime_log" "1|$web_image|$backup_image|$caddy_image|$agent_image" "unentitled target runtime recreate"
assert_contains "$runtime_log" "2|$old_web_image|$old_backup_image|$old_caddy_image|$old_agent_image" "unentitled agent rollback refs"
assert_contains "$runtime_log" "|$old_control_plane_url|production|$old_agent_version|$old_agent_memory_limit" "unentitled agent exact rollback config"
assert_contains "$docker_log" "exec -T agent printenv AGENT_VERSION" "restored agent identity verification"
assert_contains "$docker_log" "exec -T agent printenv IMAGE_DIGEST" "restored agent digest verification"
assert_contains "$record_file" 'RELEASE_TAG=v1.1.0' "unentitled agent rollback preserves old record"

write_evidence
rm -f "$record_file"
reset_logs
block_dir="$test_root/pull-block"
mkdir -p "$block_dir"
first_output="$test_root/first-deploy.log"
second_output="$test_root/second-deploy.log"
TEST_PULL_BLOCK_DIR=$block_dir
export TEST_PULL_BLOCK_DIR
run_deploy "$valid_env" "$first_output" &
first_pid=$!
wait_attempt=0
while [ ! -f "$block_dir/ready" ] && [ "$wait_attempt" -lt 100 ]; do
  sleep 0.05
  wait_attempt=$((wait_attempt + 1))
done
if [ ! -f "$block_dir/ready" ]; then
  record_failure "concurrency test did not reach pull"
  : >"$block_dir/release"
else
  if run_deploy "$valid_env" "$second_output"; then
    record_failure "second concurrent deploy unexpectedly succeeded"
  else
    assert_contains "$second_output" "deployment already in progress for project quandatics-client-test" "project lock"
  fi
  : >"$block_dir/release"
fi
if ! wait "$first_pid"; then
  record_failure "first locked deploy failed: $(cat "$first_output")"
fi
unset TEST_PULL_BLOCK_DIR
[ "$(grep -c ' pull ' "$docker_log")" -eq 1 ] || record_failure "project lock allowed more than one pull"
[ ! -d "$state_dir/.deploy-quandatics-client-test.lock" ] || record_failure "project lock remained after atomic record"

write_evidence
rm -f "$record_file"
reset_logs
if ! run_deploy "$valid_env"; then
  record_failure "valid guarded deploy failed: $(cat "$output_log")"
fi

identity="https://github.com/Super-ERP/crm-v2/.github/workflows/release-images.yml@refs/tags/v1.2.3"
issuer="https://token.actions.githubusercontent.com"
[ "$(wc -l <"$cosign_log" | tr -d ' ')" -eq 4 ] || record_failure "all four vendor images were not verified exactly once"
for image in "$web_image" "$migrator_image" "$backup_image" "$agent_image"; do
  assert_contains "$cosign_log" "verify --certificate-identity $identity --certificate-oidc-issuer $issuer $image" "exact Cosign identity"
done
assert_contains "$record_file" 'RECORD_VERSION=3' "atomic record schema"
assert_contains "$record_file" 'RELEASE_TAG=v1.2.3' "atomic record release"
assert_contains "$record_file" "SOURCE_COMMIT_SHA=$source_sha" "atomic record provenance"
assert_contains "$record_file" "WEB_IMAGE=$web_image" "atomic record web digest"
assert_contains "$record_file" "AGENT_IMAGE=$agent_image" "atomic record agent digest"
assert_not_contains "$record_file" 'RELEASE_TAG=v1.1.0' "atomic record replaced old state"
for leaked_secret in \
  test-postgres-password \
  test-application-password \
  test-better-auth-secret-with-enough-entropy \
  test-platform-master-password \
  "$agent_web_secret"; do
  for process_argv_log in "$env_argv_log" "$docker_log" "$cosign_log" "$curl_log"; do
    assert_not_contains "$process_argv_log" "$leaked_secret" "secret absent from process argv"
  done
done

compose_json="$test_root/compose.json"
if ! docker compose --file "$compose_file" --env-file "$bundle_dir/.env.example" --profile deploy config --format json >"$compose_json"; then
  record_failure "Compose config with example environment failed"
else
  jq -e '.services.gateway.networks | keys == ["frontend"]' "$compose_json" >/dev/null || record_failure "gateway is not frontend-only"
  jq -e '.services.web.networks | keys | sort == ["agent-web", "backend", "frontend"]' "$compose_json" >/dev/null || record_failure "web does not bridge frontend/backend/agent-web"
  jq -e '.services.db.networks | keys == ["backend"]' "$compose_json" >/dev/null || record_failure "database is reachable outside backend"
  jq -e '.services.backup.networks | keys | sort == ["backend", "egress"]' "$compose_json" >/dev/null || record_failure "backup lacks isolated backend plus outbound transport"
  jq -e '.services.migrate.networks | keys == ["backend"]' "$compose_json" >/dev/null || record_failure "migrator is reachable outside backend"
  jq -e '.services.agent.image | startswith("ghcr.io/super-erp/crm-deployment-agent@sha256:")' "$compose_json" >/dev/null || record_failure "agent image is not digest-only"
  jq -e '.services.agent.networks | keys | sort == ["agent-egress", "agent-web"]' "$compose_json" >/dev/null || record_failure "agent network boundary is not isolated"
  jq -e '.networks["agent-web"].internal == true' "$compose_json" >/dev/null || record_failure "agent-web network is not internal"
  jq -e '(.services.agent.environment | keys | sort) == ["AGENT_VERSION", "AGENT_WEB_SECRET", "APPLICATION_VERSION", "CONTROL_PLANE_URL", "DEPLOYMENT_ENV", "DEPLOYMENT_ID", "IMAGE_DIGEST", "INSTALLATION_TOKEN", "MIGRATION_VERSION", "WEB_INTERNAL_URL"]' "$compose_json" >/dev/null || record_failure "agent environment exceeds allowlist"
  jq -e '[.services.agent.volumes[].target] == ["/var/lib/crm-agent"]' "$compose_json" >/dev/null || record_failure "agent mount boundary is not private state only"
  jq -e '.services.agent.read_only == true and .services.agent.cap_drop == ["ALL"] and .services.agent.pids_limit > 0 and (.services.agent.security_opt | index("no-new-privileges:true")) != null' "$compose_json" >/dev/null || record_failure "agent container hardening is incomplete"
  jq -e '(.services.agent.ports // []) == [] and (.services.agent.volumes | map(.source) | index("/var/run/docker.sock")) == null' "$compose_json" >/dev/null || record_failure "agent exposes a port or Docker socket"
  jq -e '.networks.backend.internal == true' "$compose_json" >/dev/null || record_failure "backend network is not internal"
  jq -e '.services.gateway.ports[0].host_ip == "0.0.0.0"' "$compose_json" >/dev/null || record_failure "gateway does not default to host-facing bind"
  jq -e '.services.db.ports[0].host_ip == "127.0.0.1"' "$compose_json" >/dev/null || record_failure "database administration does not bind loopback"
  jq -e '(.services.gateway.environment // {}) == {}' "$compose_json" >/dev/null || record_failure "gateway retains dead DOMAIN/ACME variables"
fi

if [ "$failures" -ne 0 ]; then
  echo "client bundle test failed: $failures boundary checks" >&2
  exit 1
fi

echo "client bundle test passed"
