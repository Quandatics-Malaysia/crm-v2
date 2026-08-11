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

for required_file in compose.yaml Caddyfile .env.example deploy.sh verify-images.sh healthcheck.sh README.md; do
  [ -f "$bundle_dir/$required_file" ] || record_failure "missing deploy/client/$required_file"
done

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
output_log="$test_root/output.log"
docker_counter="$test_root/docker-counter"
curl_counter="$test_root/curl-counter"

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
  *" up -d --no-deps --force-recreate web backup gateway "*|*" up -d --no-deps --force-recreate web backup gateway")
    count=0
    [ ! -f "$TEST_DOCKER_COUNTER" ] || count=$(cat "$TEST_DOCKER_COUNTER")
    count=$((count + 1))
    printf '%s\n' "$count" >"$TEST_DOCKER_COUNTER"
    printf '%s|%s|%s|%s\n' "$count" "${WEB_IMAGE:-}" "${BACKUP_IMAGE:-}" "${CADDY_IMAGE:-}" >>"$TEST_RUNTIME_LOG"
    if [ "${TEST_RUNTIME_FAIL_ONCE:-0}" = 1 ] && [ "$count" -eq 1 ]; then
      exit 44
    fi
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

chmod 0755 "$fake_bin/docker" "$fake_bin/cosign" "$fake_bin/curl" "$fake_bin/stat"

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
postgres_digest=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
caddy_digest=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
source_sha=1111111111111111111111111111111111111111
web_image="ghcr.io/quandatics-malaysia/crm-web@sha256:$web_digest"
migrator_image="ghcr.io/quandatics-malaysia/crm-migrator@sha256:$migrator_digest"
backup_image="ghcr.io/quandatics-malaysia/crm-backup@sha256:$backup_digest"
postgres_image="docker.io/library/postgres@sha256:$postgres_digest"
caddy_image="docker.io/library/caddy@sha256:$caddy_digest"

old_web_image="ghcr.io/quandatics-malaysia/crm-web@sha256:1111111111111111111111111111111111111111111111111111111111111111"
old_migrator_image="ghcr.io/quandatics-malaysia/crm-migrator@sha256:2222222222222222222222222222222222222222222222222222222222222222"
old_backup_image="ghcr.io/quandatics-malaysia/crm-backup@sha256:3333333333333333333333333333333333333333333333333333333333333333"
old_postgres_image="docker.io/library/postgres@sha256:4444444444444444444444444444444444444444444444444444444444444444"
old_caddy_image="docker.io/library/caddy@sha256:5555555555555555555555555555555555555555555555555555555555555555"

cat >"$valid_env" <<EOF
COMPOSE_PROJECT_NAME=quandatics-client-test
RELEASE_TAG=v1.2.3
SOURCE_COMMIT_SHA=$source_sha
WEB_IMAGE=$web_image
MIGRATOR_IMAGE=$migrator_image
BACKUP_IMAGE=$backup_image
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
DEPLOYMENT_ID=deployment-test
STORAGE_ID=storage-test
DB_NAME=crm
AGENT_WEB_SECRET=test-agent-web-secret
APPLICATION_VERSION=1.2.3
MIGRATION_VERSION=1.2.3
VENDOR_ENTITLEMENT_TRUST_SET=test-trust-set
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
  printf 'encrypted backup bytes\n' >"$artifact_file"
  chmod 0600 "$artifact_file"
  artifact_sha256=$(sha256_file "$artifact_file")
  now=$(date +%s)
  cat >"$evidence_file" <<EOF
EVIDENCE_VERSION=1
DEPLOYMENT_ID=deployment-test
COMPOSE_PROJECT_NAME=$evidence_project
DB_NAME=crm
STORAGE_ID=storage-test
POSTGRES_IMAGE=$postgres_image
RELEASE_TAG=v1.2.3
WEB_IMAGE=$evidence_web
MIGRATOR_IMAGE=$migrator_image
BACKUP_IMAGE=$backup_image
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
RECORD_VERSION=1
RELEASE_TAG=v1.1.0
SOURCE_COMMIT_SHA=0000000000000000000000000000000000000000
DEPLOYMENT_ID=deployment-test
COMPOSE_PROJECT_NAME=quandatics-client-test
DB_NAME=crm
STORAGE_ID=storage-test
WEB_IMAGE=$old_web_image
MIGRATOR_IMAGE=$old_migrator_image
BACKUP_IMAGE=$old_backup_image
POSTGRES_IMAGE=$old_postgres_image
CADDY_IMAGE=$old_caddy_image
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
  rm -f "$docker_counter" "$curl_counter"
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
    TEST_DOCKER_COUNTER="$docker_counter" \
    TEST_CURL_COUNTER="$curl_counter" \
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
copy_env_with_replacement "$valid_env" WEB_IMAGE "ghcr.io/quandatics-malaysia/crm-web-shadow@sha256:$web_digest" "$wrong_repo_env"
expect_deploy_failure "wrong vendor repository" "$wrong_repo_env" "WEB_IMAGE must use exact repository ghcr.io/quandatics-malaysia/crm-web"

wrong_upstream_env="$test_root/wrong-upstream.env"
copy_env_with_replacement "$valid_env" POSTGRES_IMAGE "registry.example/postgres@sha256:$postgres_digest" "$wrong_upstream_env"
expect_deploy_failure "wrong upstream repository" "$wrong_upstream_env" "POSTGRES_IMAGE must use exact repository docker.io/library/postgres"

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
assert_contains "$runtime_log" "1|$web_image|$backup_image|$caddy_image" "target runtime recreate attempt"
assert_contains "$runtime_log" "2|$old_web_image|$old_backup_image|$old_caddy_image" "partial recreate rollback refs"
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
assert_contains "$runtime_log" "2|$old_web_image|$old_backup_image|$old_caddy_image" "health rollback refs"
[ "$(wc -l <"$curl_log" | tr -d ' ')" -eq 3 ] || record_failure "rollback did not exhaust new health and verify restored health"
assert_contains "$record_file" 'RELEASE_TAG=v1.1.0' "health rollback preserves old record"

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

identity="https://github.com/Quandatics-Malaysia/crm-v2/.github/workflows/release-images.yml@refs/tags/v1.2.3"
issuer="https://token.actions.githubusercontent.com"
[ "$(wc -l <"$cosign_log" | tr -d ' ')" -eq 3 ] || record_failure "all three vendor images were not verified exactly once"
for image in "$web_image" "$migrator_image" "$backup_image"; do
  assert_contains "$cosign_log" "verify --certificate-identity $identity --certificate-oidc-issuer $issuer $image" "exact Cosign identity"
done
assert_contains "$record_file" 'RECORD_VERSION=1' "atomic record schema"
assert_contains "$record_file" 'RELEASE_TAG=v1.2.3' "atomic record release"
assert_contains "$record_file" "SOURCE_COMMIT_SHA=$source_sha" "atomic record provenance"
assert_contains "$record_file" "WEB_IMAGE=$web_image" "atomic record web digest"
assert_not_contains "$record_file" 'RELEASE_TAG=v1.1.0' "atomic record replaced old state"

compose_json="$test_root/compose.json"
if ! docker compose --file "$compose_file" --env-file "$bundle_dir/.env.example" --profile deploy config --format json >"$compose_json"; then
  record_failure "Compose config with example environment failed"
else
  jq -e '.services.gateway.networks | keys == ["frontend"]' "$compose_json" >/dev/null || record_failure "gateway is not frontend-only"
  jq -e '.services.web.networks | keys | sort == ["backend", "frontend"]' "$compose_json" >/dev/null || record_failure "web does not bridge frontend/backend"
  jq -e '.services.db.networks | keys == ["backend"]' "$compose_json" >/dev/null || record_failure "database is reachable outside backend"
  jq -e '.services.backup.networks | keys | sort == ["backend", "egress"]' "$compose_json" >/dev/null || record_failure "backup lacks isolated backend plus outbound transport"
  jq -e '.services.migrate.networks | keys == ["backend"]' "$compose_json" >/dev/null || record_failure "migrator is reachable outside backend"
  jq -e '.networks.backend.internal == true' "$compose_json" >/dev/null || record_failure "backend network is not internal"
  jq -e '.services.gateway.ports[0].host_ip == "127.0.0.1"' "$compose_json" >/dev/null || record_failure "gateway does not default to loopback"
  jq -e '.services.db.ports[0].host_ip == "127.0.0.1"' "$compose_json" >/dev/null || record_failure "database administration does not bind loopback"
  jq -e '(.services.gateway.environment // {}) == {}' "$compose_json" >/dev/null || record_failure "gateway retains dead DOMAIN/ACME variables"
fi

if [ "$failures" -ne 0 ]; then
  echo "client bundle test failed: $failures boundary checks" >&2
  exit 1
fi

echo "client bundle test passed"
