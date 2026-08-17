#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname "$0")/../../../.." && pwd)
script=$repo_root/deploy/client/ops/prepare-backup-evidence.sh
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT

mkdir -p "$test_root/bin" "$test_root/client" "$test_root/state/backup"
cat >"$test_root/bin/docker" <<'EOF'
#!/bin/sh
set -eu
case " $* " in
  *" exec "*) [ "${FAKE_DOCKER_FAIL_EXEC:-0}" = 0 ] ;;
  *" cp "*)
    for argument do destination=$argument; done
    printf 'verified backup fixture\n' >"$destination"
    ;;
  *) exit 1 ;;
esac
EOF
chmod 0755 "$test_root/bin/docker"

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$test_root/client/backup-evidence.key" >/dev/null 2>&1
openssl pkey -in "$test_root/client/backup-evidence.key" -pubout -out "$test_root/state/backup-evidence.pub" >/dev/null 2>&1
chmod 0600 "$test_root/client/backup-evidence.key" "$test_root/state/backup-evidence.pub"
public_key_sha=$(sha256sum "$test_root/state/backup-evidence.pub" | awk '{ print $1 }')

cat >"$test_root/state/deployed-release.env" <<'EOF'
RECORD_VERSION=3
RELEASE_TAG=v1.2.34
SOURCE_COMMIT_SHA=1111111111111111111111111111111111111111
DEPLOYMENT_ID=11111111-1111-4111-8111-111111111111
COMPOSE_PROJECT_NAME=quandatics-client
DB_NAME=crm
STORAGE_ID=storage-1
WEB_IMAGE=ghcr.io/super-erp/crm-web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
MIGRATOR_IMAGE=ghcr.io/super-erp/crm-migrator@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
BACKUP_IMAGE=ghcr.io/super-erp/crm-backup@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
POSTGRES_IMAGE=docker.io/library/postgres@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
EOF
chmod 0600 "$test_root/state/deployed-release.env"

cat >"$test_root/client/.env" <<EOF
BACKUP_EVIDENCE_FILE=$test_root/state/backup/verified-release.env
BACKUP_EVIDENCE_SIGNATURE_FILE=$test_root/state/backup/verified-release.env.sig
BACKUP_EVIDENCE_PUBLIC_KEY_FILE=$test_root/state/backup-evidence.pub
BACKUP_EVIDENCE_PUBLIC_KEY_SHA256=$public_key_sha
DEPLOYMENT_RECORD_FILE=$test_root/state/deployed-release.env
EOF
chmod 0600 "$test_root/client/.env"
touch "$test_root/client/compose.yaml"

PATH="$test_root/bin:$PATH" "$script" "$test_root/client/.env" "$test_root/client/backup-evidence.key"
evidence=$test_root/state/backup/verified-release.env
signature=$test_root/state/backup/verified-release.env.sig
grep -qx 'RELEASE_TAG=v1.2.34' "$evidence"
grep -qx 'RESTORE_VERIFIED=true' "$evidence"
grep -qx 'UPLOAD_VERIFIED=true' "$evidence"
openssl dgst -sha256 -verify "$test_root/state/backup-evidence.pub" -signature "$signature" "$evidence" >/dev/null

before=$(sha256sum "$evidence" "$signature")
if FAKE_DOCKER_FAIL_EXEC=1 PATH="$test_root/bin:$PATH" \
  "$script" "$test_root/client/.env" "$test_root/client/backup-evidence.key" >/dev/null 2>&1; then
  echo "producer accepted failed backup verification" >&2
  exit 1
fi
after=$(sha256sum "$evidence" "$signature")
[ "$before" = "$after" ] || { echo "failed producer replaced valid evidence" >&2; exit 1; }

echo "prepare-backup-evidence tests passed"
