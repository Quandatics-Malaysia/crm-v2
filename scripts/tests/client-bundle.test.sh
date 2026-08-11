#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
bundle_dir="$repo_root/deploy/client"
compose_file="$bundle_dir/compose.yaml"
deploy_script="$bundle_dir/deploy.sh"

fail() {
  echo "client bundle test failed: $*" >&2
  exit 1
}

assert_contains() {
  file=$1
  expected=$2
  grep -Fq -- "$expected" "$file" || fail "expected '$expected' in $file"
}

assert_no_stack_mutation() {
  log_file=$1
  if grep -Eq ' (pull|up|run|down|restart|stop|rm|create) ' "$log_file"; then
    fail "unexpected stack mutation: $(grep -E ' (pull|up|run|down|restart|stop|rm|create) ' "$log_file")"
  fi
}

if [ ! -f "$compose_file" ]; then
  echo "missing deploy/client/compose.yaml" >&2
  exit 1
fi

for required_file in Caddyfile .env.example deploy.sh verify-images.sh healthcheck.sh README.md; do
  [ -f "$bundle_dir/$required_file" ] || fail "missing deploy/client/$required_file"
done

assert_contains "$compose_file" 'name: ${COMPOSE_PROJECT_NAME:?'

if grep -Eq '^[[:space:]]*build:' "$compose_file"; then
  fail "client compose must not contain build keys"
fi

for image_variable in WEB_IMAGE MIGRATOR_IMAGE BACKUP_IMAGE POSTGRES_IMAGE CADDY_IMAGE; do
  if ! grep -Fq "image: \${$image_variable:?" "$compose_file"; then
    fail "client compose must use $image_variable"
  fi
done

if ! grep -Eq '127\.0\.0\.1:\$\{DB_HOST_PORT' "$compose_file"; then
  fail "database administration port must bind to 127.0.0.1"
fi

ports_blocks=$(grep -Ec '^[[:space:]]{4}ports:$' "$compose_file")
[ "$ports_blocks" -eq 2 ] || fail "only database loopback and gateway may publish ports"

if grep -Eq '^[[:space:]]*image:[[:space:]]+[^$[:space:]]' "$compose_file"; then
  fail "every client image must come from an immutable environment reference"
fi

for shell_file in "$bundle_dir"/*.sh; do
  sh -n "$shell_file"
done

if grep -Eq 'git[[:space:]]+(pull|clone|fetch)|docker[[:space:]]+compose[[:space:]]+(build|down)|compose[[:space:]].*down[[:space:]]+-v' "$bundle_dir"/*.sh; then
  fail "client scripts must not fetch source, build images, or delete Compose volumes"
fi

test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
fake_bin="$test_root/bin"
mkdir -p "$fake_bin" "$test_root/state"
docker_log="$test_root/docker.log"
cosign_log="$test_root/cosign.log"
curl_log="$test_root/curl.log"
output_log="$test_root/output.log"

cat >"$fake_bin/docker" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$TEST_DOCKER_LOG"
case " $* " in
  *" pull "*)
    [ "${TEST_DOCKER_FAIL_PULL:-0}" = 1 ] && exit 42
    ;;
esac
exit 0
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
exit "${TEST_CURL_EXIT:-0}"
EOF

chmod +x "$fake_bin/docker" "$fake_bin/cosign" "$fake_bin/curl"
: >"$docker_log"
: >"$cosign_log"
: >"$curl_log"

web_digest=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
migrator_digest=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
backup_digest=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
postgres_digest=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
caddy_digest=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
web_image="ghcr.io/quandatics-malaysia/crm-web@sha256:$web_digest"
migrator_image="ghcr.io/quandatics-malaysia/crm-migrator@sha256:$migrator_digest"
backup_image="ghcr.io/quandatics-malaysia/crm-backup@sha256:$backup_digest"
marker_file="$test_root/backup-marker.env"
record_file="$test_root/state/deployed-release.env"
valid_env="$test_root/valid.env"

cat >"$valid_env" <<EOF
COMPOSE_PROJECT_NAME=quandatics-client-test
RELEASE_TAG=v1.2.3
WEB_IMAGE=$web_image
MIGRATOR_IMAGE=$migrator_image
BACKUP_IMAGE=$backup_image
POSTGRES_IMAGE=docker.io/library/postgres@sha256:$postgres_digest
CADDY_IMAGE=docker.io/library/caddy@sha256:$caddy_digest
POSTGRES_PASSWORD=test-postgres-password
CRM_APP_PASSWORD=test-application-password
BETTER_AUTH_SECRET=test-better-auth-secret-with-enough-entropy
PLATFORM_MASTER_EMAIL=owner@example.test
PLATFORM_MASTER_PASSWORD=test-platform-master-password
DEPLOYMENT_ID=deployment-test
AGENT_WEB_SECRET=test-agent-web-secret
APPLICATION_VERSION=1.2.3
MIGRATION_VERSION=1.2.3
VENDOR_ENTITLEMENT_TRUST_SET=test-trust-set
BACKUP_MARKER_FILE=$marker_file
BACKUP_MAX_AGE_SECONDS=3600
DEPLOYMENT_RECORD_FILE=$record_file
HEALTHCHECK_URL=http://127.0.0.1:8081/api/health
HEALTHCHECK_ATTEMPTS=2
HEALTHCHECK_INTERVAL_SECONDS=0
EOF

write_marker() {
  created_at=$1
  marker_web_image=${2:-$web_image}
  cat >"$marker_file" <<EOF
RELEASE_TAG=v1.2.3
WEB_IMAGE=$marker_web_image
MIGRATOR_IMAGE=$migrator_image
BACKUP_IMAGE=$backup_image
CREATED_AT_EPOCH=$created_at
DUMP_SHA256=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
CHECKSUM_VERIFIED=true
RESTORE_VERIFIED=true
UPLOAD_VERIFIED=true
EOF
}

reset_logs() {
  : >"$docker_log"
  : >"$cosign_log"
  : >"$curl_log"
  rm -f "$record_file"
}

run_deploy() {
  env_file=$1
  PATH="$fake_bin:/usr/bin:/bin" \
    TEST_DOCKER_LOG="$docker_log" \
    TEST_COSIGN_LOG="$cosign_log" \
    TEST_CURL_LOG="$curl_log" \
    TEST_DOCKER_FAIL_PULL="${TEST_DOCKER_FAIL_PULL:-0}" \
    TEST_COSIGN_FAIL_IMAGE="${TEST_COSIGN_FAIL_IMAGE:-}" \
    TEST_CURL_EXIT="${TEST_CURL_EXIT:-0}" \
    "$deploy_script" "$env_file" >"$output_log" 2>&1
}

expect_deploy_failure() {
  env_file=$1
  expected=$2
  if run_deploy "$env_file"; then
    fail "deploy unexpectedly succeeded: $expected"
  fi
  assert_contains "$output_log" "$expected"
}

now=$(date +%s)
write_marker "$now"

no_cosign_bin="$test_root/no-cosign-bin"
mkdir -p "$no_cosign_bin"
ln -s "$(command -v grep)" "$no_cosign_bin/grep"
if PATH="$no_cosign_bin" \
  RELEASE_TAG=v1.2.3 \
  WEB_IMAGE="$web_image" \
  MIGRATOR_IMAGE="$migrator_image" \
  BACKUP_IMAGE="$backup_image" \
  "$bundle_dir/verify-images.sh" >"$output_log" 2>&1; then
  fail "image verification succeeded without cosign"
fi
assert_contains "$output_log" "cosign is required but not installed"

invalid_env="$test_root/invalid-image.env"
sed 's#^WEB_IMAGE=.*#WEB_IMAGE=ghcr.io/quandatics-malaysia/crm-web:latest#' "$valid_env" >"$invalid_env"
reset_logs
expect_deploy_failure "$invalid_env" "WEB_IMAGE must be an immutable sha256 digest reference"
[ ! -s "$cosign_log" ] || fail "invalid image reached signature verification"
[ ! -s "$docker_log" ] || fail "invalid image reached Docker"

placeholder_env="$test_root/placeholder.env"
sed 's#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=CHANGE_ME_POSTGRES#' "$valid_env" >"$placeholder_env"
reset_logs
expect_deploy_failure "$placeholder_env" "POSTGRES_PASSWORD still contains a placeholder"
[ ! -s "$cosign_log" ] || fail "invalid environment reached signature verification"
[ ! -s "$docker_log" ] || fail "invalid environment reached Docker"

invalid_record_env="$test_root/invalid-record.env"
sed "s#^DEPLOYMENT_RECORD_FILE=.*#DEPLOYMENT_RECORD_FILE=$test_root/missing-state/deployed-release.env#" "$valid_env" >"$invalid_record_env"
reset_logs
expect_deploy_failure "$invalid_record_env" "DEPLOYMENT_RECORD_FILE parent directory must already exist and be writable"
[ ! -s "$cosign_log" ] || fail "invalid record destination reached signature verification"
[ ! -s "$docker_log" ] || fail "invalid record destination reached Docker"

reset_logs
TEST_COSIGN_FAIL_IMAGE=$migrator_image
export TEST_COSIGN_FAIL_IMAGE
expect_deploy_failure "$valid_env" "signature verification failed"
assert_no_stack_mutation "$docker_log"
unset TEST_COSIGN_FAIL_IMAGE

write_marker "$now" "ghcr.io/quandatics-malaysia/crm-web@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
reset_logs
expect_deploy_failure "$valid_env" "backup marker WEB_IMAGE does not match intended release"
assert_no_stack_mutation "$docker_log"

write_marker "$((now - 3601))"
reset_logs
expect_deploy_failure "$valid_env" "verified backup marker is stale"
assert_no_stack_mutation "$docker_log"

write_marker "$now"
reset_logs
TEST_DOCKER_FAIL_PULL=1
export TEST_DOCKER_FAIL_PULL
expect_deploy_failure "$valid_env" "image pull failed; running containers were not changed"
if grep -Eq ' (up|run|down|restart|stop|rm|create) ' "$docker_log"; then
  fail "failed pull changed running stack"
fi
unset TEST_DOCKER_FAIL_PULL

reset_logs
TEST_CURL_EXIT=22
export TEST_CURL_EXIT
expect_deploy_failure "$valid_env" "health check failed"
[ ! -e "$record_file" ] || fail "unhealthy release must not be recorded"
unset TEST_CURL_EXIT

reset_logs
run_deploy "$valid_env" || fail "valid guarded deploy failed: $(cat "$output_log")"

pull_line=$(grep -n ' pull ' "$docker_log" | cut -d: -f1)
migrate_line=$(grep -n ' run --rm --no-deps migrate' "$docker_log" | cut -d: -f1)
recreate_line=$(grep -n ' up -d --no-deps --force-recreate web backup gateway' "$docker_log" | cut -d: -f1)
[ -n "$pull_line" ] || fail "deploy did not pull images"
[ -n "$migrate_line" ] || fail "deploy did not run migrator"
[ -n "$recreate_line" ] || fail "deploy did not recreate runtime services"
[ "$pull_line" -lt "$migrate_line" ] || fail "migration ran before pull completed"
[ "$migrate_line" -lt "$recreate_line" ] || fail "runtime services recreated before migration"
[ "$(grep -c ' run --rm --no-deps migrate' "$docker_log")" -eq 1 ] || fail "migrator must run exactly once"

identity="https://github.com/Quandatics-Malaysia/crm-v2/.github/workflows/release-images.yml@refs/tags/v1.2.3"
issuer="https://token.actions.githubusercontent.com"
[ "$(wc -l <"$cosign_log" | tr -d ' ')" -eq 3 ] || fail "all three vendor images must be verified"
for image in "$web_image" "$migrator_image" "$backup_image"; do
  assert_contains "$cosign_log" "verify --certificate-identity $identity --certificate-oidc-issuer $issuer $image"
done

[ -s "$curl_log" ] || fail "deploy did not wait for gateway health"
assert_contains "$record_file" "RELEASE_TAG=v1.2.3"
assert_contains "$record_file" "WEB_IMAGE=$web_image"
assert_contains "$record_file" "MIGRATOR_IMAGE=$migrator_image"
assert_contains "$record_file" "BACKUP_IMAGE=$backup_image"

if find "$test_root/state" -name '.deployed-release.env.*' -print | grep -q .; then
  fail "atomic deployment record temporary file was left behind"
fi

echo "client bundle test passed"
