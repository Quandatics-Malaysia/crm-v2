#!/bin/sh
set -eu

fail() { echo "prepare-backup: $*" >&2; exit 1; }

case $# in
  2) ;;
  *) fail "usage: prepare-backup-evidence.sh <env-file> <private-key-file>" ;;
esac

env_file=$1
private_key=$2
client_dir=$(CDPATH= cd -- "$(dirname "$env_file")" && pwd)

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}
file_owner() {
  stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1"
}
assert_secure_file() {
  [ -f "$1" ] && [ ! -L "$1" ] || fail "$2 must be a regular file"
  [ "$(file_owner "$1")" = "$(id -u)" ] || fail "$2 must be owned by the deployment user"
  [ "$(file_mode "$1")" = 600 ] || fail "$2 must have mode 0600"
}
read_value() {
  value=$(awk -F= -v key="$2" '
    $1 == key { sub(/^[^=]*=/, ""); print; found++ }
    END { if (found != 1) exit 1 }
  ' "$1") || fail "$2 is missing or duplicated"
  [ -n "$value" ] || fail "$2 must not be empty"
  printf '%s\n' "$value"
}
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}
validate_image() {
  case "$2" in
    "$1"@sha256:*) digest=${2#*@sha256:} ;;
    *) fail "$3 is invalid" ;;
  esac
  printf '%s\n' "$digest" | grep -Eq '^[0-9a-f]{64}$' || fail "$3 is invalid"
}

assert_secure_file "$env_file" "environment file"
assert_secure_file "$private_key" "backup evidence private key"
openssl pkey -in "$private_key" -noout >/dev/null 2>&1 || fail "backup evidence private key is invalid"

evidence_file=$(read_value "$env_file" BACKUP_EVIDENCE_FILE)
signature_file=$(read_value "$env_file" BACKUP_EVIDENCE_SIGNATURE_FILE)
public_key=$(read_value "$env_file" BACKUP_EVIDENCE_PUBLIC_KEY_FILE)
public_key_sha=$(read_value "$env_file" BACKUP_EVIDENCE_PUBLIC_KEY_SHA256)
record_file=$(read_value "$env_file" DEPLOYMENT_RECORD_FILE)
case "$evidence_file:$signature_file:$public_key:$record_file" in
  /*:/*:/*:/*) ;;
  *) fail "backup and deployment record paths must be absolute" ;;
esac
printf '%s\n' "$public_key_sha" | grep -Eq '^[0-9a-f]{64}$' || fail "public key pin is invalid"
assert_secure_file "$public_key" "backup evidence public key"
[ "$(sha256_file "$public_key")" = "$public_key_sha" ] || fail "backup evidence public key pin mismatch"
assert_secure_file "$record_file" "deployment record"

[ "$(read_value "$record_file" RECORD_VERSION)" = 3 ] || fail "unsupported deployment record"
release_tag=$(read_value "$record_file" RELEASE_TAG)
source_sha=$(read_value "$record_file" SOURCE_COMMIT_SHA)
deployment_id=$(read_value "$record_file" DEPLOYMENT_ID)
compose_project=$(read_value "$record_file" COMPOSE_PROJECT_NAME)
db_name=$(read_value "$record_file" DB_NAME)
storage_id=$(read_value "$record_file" STORAGE_ID)
web_image=$(read_value "$record_file" WEB_IMAGE)
migrator_image=$(read_value "$record_file" MIGRATOR_IMAGE)
backup_image=$(read_value "$record_file" BACKUP_IMAGE)
postgres_image=$(read_value "$record_file" POSTGRES_IMAGE)

printf '%s\n' "$release_tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail "deployed release tag is invalid"
printf '%s\n' "$source_sha" | grep -Eq '^([0-9a-f]{40}|[0-9a-f]{64})$' || fail "deployed source SHA is invalid"
printf '%s\n' "$deployment_id" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' ||
  fail "deployment ID is invalid"
printf '%s\n' "$compose_project" | grep -Eq '^[a-z0-9][a-z0-9_-]{0,62}$' || fail "Compose project is invalid"
printf '%s\n' "$db_name" | grep -Eq '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$' || fail "database name is invalid"
printf '%s\n' "$storage_id" | grep -Eq '^[A-Za-z0-9._-]+$' || fail "storage ID is invalid"
validate_image ghcr.io/super-erp/crm-web "$web_image" WEB_IMAGE
validate_image ghcr.io/super-erp/crm-migrator "$migrator_image" MIGRATOR_IMAGE
validate_image ghcr.io/super-erp/crm-backup "$backup_image" BACKUP_IMAGE
validate_image docker.io/library/postgres "$postgres_image" POSTGRES_IMAGE

evidence_dir=$(dirname "$evidence_file")
signature_dir=$(dirname "$signature_file")
[ "$evidence_dir" = "$signature_dir" ] || fail "evidence and signature must share a directory"
[ -d "$evidence_dir" ] && [ ! -L "$evidence_dir" ] || fail "backup evidence directory is invalid"

umask 077
temp_dir=$(mktemp -d "$evidence_dir/.prepare-backup.XXXXXX") || fail "could not create backup workspace"
restore_publication=0
had_prior_evidence=0
had_prior_signature=0
cleanup() {
  if [ "$restore_publication" -eq 1 ]; then
    if [ "$had_prior_evidence" -eq 1 ]; then
      cp "$temp_dir/prior-evidence.env" "$temp_dir/restore-evidence.env" 2>/dev/null || true
      chmod 0600 "$temp_dir/restore-evidence.env" 2>/dev/null || true
      mv -f "$temp_dir/restore-evidence.env" "$evidence_file" 2>/dev/null || true
    else
      rm -f "$evidence_file"
    fi
    if [ "$had_prior_signature" -eq 1 ]; then
      cp "$temp_dir/prior-evidence.env.sig" "$temp_dir/restore-evidence.env.sig" 2>/dev/null || true
      chmod 0600 "$temp_dir/restore-evidence.env.sig" 2>/dev/null || true
      mv -f "$temp_dir/restore-evidence.env.sig" "$signature_file" 2>/dev/null || true
    else
      rm -f "$signature_file"
    fi
  fi
  rm -rf -- "$temp_dir"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
epoch=$(date +%s)
verify_db="crm_release_verify_${epoch}_$$"
container_prefix="/var/lib/backup/work/predeploy-${release_tag#v}-$epoch-$$"

docker compose --project-name "$compose_project" --env-file "$env_file" \
  -f "$client_dir/compose.yaml" exec -T backup sh -s -- \
  "$container_prefix.dump" "$container_prefix.uploads.tar.gz" "$verify_db" <<'EOF'
set -eu
dump=$1
uploads=$2
verify_db=$3
case "${DATABASE_ADMIN_URL:-}" in postgresql://*|postgres://*) ;; *) echo "backup runtime database URL is invalid" >&2; exit 1 ;; esac
base_url=${DATABASE_ADMIN_URL%/*}/postgres
verify_url=${DATABASE_ADMIN_URL%/*}/$verify_db
cleanup() { psql "$base_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$verify_db\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
mkdir -p "$(dirname "$dump")"
pg_dump --format=custom --file="$dump" "$DATABASE_ADMIN_URL"
tar -czf "$uploads" -C /data/uploads .
cleanup
psql "$base_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$verify_db\"" >/dev/null
pg_restore --exit-on-error --no-owner --no-privileges -d "$verify_url" "$dump" >/dev/null
table_count=$(psql "$verify_url" -v ON_ERROR_STOP=1 -Atc "select count(*) from information_schema.tables where table_schema='public'")
[ "$table_count" -gt 0 ]
EOF

docker compose --project-name "$compose_project" --env-file "$env_file" \
  -f "$client_dir/compose.yaml" cp "backup:$container_prefix.dump" "$temp_dir/database.dump"
docker compose --project-name "$compose_project" --env-file "$env_file" \
  -f "$client_dir/compose.yaml" cp "backup:$container_prefix.uploads.tar.gz" "$temp_dir/uploads.tar.gz"
docker compose --project-name "$compose_project" --env-file "$env_file" \
  -f "$client_dir/compose.yaml" exec -T backup rm -f \
  "$container_prefix.dump" "$container_prefix.uploads.tar.gz"

artifact_file="$evidence_dir/predeploy-${release_tag#v}-$epoch.tar.gz"
artifact_tmp="$temp_dir/$(basename "$artifact_file")"
tar -czf "$artifact_tmp" -C "$temp_dir" database.dump uploads.tar.gz
chmod 0600 "$artifact_tmp"
artifact_sha=$(sha256_file "$artifact_tmp")
[ "$(sha256_file "$artifact_tmp")" = "$artifact_sha" ] || fail "backup artifact checksum verification failed"

evidence_tmp=$temp_dir/verified-release.env
signature_tmp=$temp_dir/verified-release.env.sig
{
  printf 'EVIDENCE_VERSION=1\n'
  printf 'DEPLOYMENT_ID=%s\n' "$deployment_id"
  printf 'COMPOSE_PROJECT_NAME=%s\n' "$compose_project"
  printf 'DB_NAME=%s\n' "$db_name"
  printf 'STORAGE_ID=%s\n' "$storage_id"
  printf 'POSTGRES_IMAGE=%s\n' "$postgres_image"
  printf 'RELEASE_TAG=%s\n' "$release_tag"
  printf 'WEB_IMAGE=%s\n' "$web_image"
  printf 'MIGRATOR_IMAGE=%s\n' "$migrator_image"
  printf 'BACKUP_IMAGE=%s\n' "$backup_image"
  printf 'SOURCE_COMMIT_SHA=%s\n' "$source_sha"
  printf 'CREATED_AT_EPOCH=%s\n' "$epoch"
  printf 'BACKUP_ARTIFACT_FILE=%s\n' "$artifact_file"
  printf 'BACKUP_ARTIFACT_SHA256=%s\n' "$artifact_sha"
  printf 'CHECKSUM_VERIFIED=true\n'
  printf 'RESTORE_VERIFIED=true\n'
  printf 'UPLOAD_VERIFIED=true\n'
} >"$evidence_tmp"
chmod 0600 "$evidence_tmp"
openssl dgst -sha256 -sign "$private_key" -out "$signature_tmp" "$evidence_tmp"
chmod 0600 "$signature_tmp"
openssl dgst -sha256 -verify "$public_key" -signature "$signature_tmp" "$evidence_tmp" >/dev/null 2>&1 ||
  fail "generated backup evidence signature is invalid"

mv "$artifact_tmp" "$artifact_file"
[ ! -f "$evidence_file" ] || { cp "$evidence_file" "$temp_dir/prior-evidence.env"; had_prior_evidence=1; }
[ ! -f "$signature_file" ] || { cp "$signature_file" "$temp_dir/prior-evidence.env.sig"; had_prior_signature=1; }
restore_publication=1
mv "$evidence_tmp" "$evidence_file"
mv "$signature_tmp" "$signature_file"
restore_publication=0
echo "prepared signed backup evidence for $release_tag"
