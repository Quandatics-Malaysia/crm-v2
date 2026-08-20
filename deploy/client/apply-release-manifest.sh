#!/bin/sh
set -eu

fail() { echo "release manifest: $*" >&2; exit 1; }

env_file=${1:-}
manifest=${2:-}
expected_tag=${3:-}
[ -n "$env_file" ] && [ -n "$manifest" ] && [ -n "$expected_tag" ] ||
  fail "usage: apply-release-manifest.sh ENV_FILE MANIFEST RELEASE_TAG"
[ -f "$env_file" ] && [ ! -L "$env_file" ] || fail "invalid environment file"
[ -f "$manifest" ] && [ ! -L "$manifest" ] || fail "invalid manifest file"
command -v jq >/dev/null 2>&1 || fail "jq is required"

jq -e --arg tag "$expected_tag" '
  .release_tag == $tag and
  (.release_tag | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$")) and
  (.workflow_identity == ("https://github.com/Super-ERP/crm-v2/.github/workflows/release-images.yml@refs/tags/" + $tag) or
   .workflow_identity == ("https://github.com/Super-ERP/crm-v2/.github/workflows/release-images.yml@refs/heads/main")) and
  (.source_commit | test("^[0-9a-f]{40}$")) and
  (.release_version | test("^[0-9]+\\.[0-9]+\\.[0-9]+$")) and
  (.migration_version | test("^[0-9]{4}$")) and
  (.images | length == 4) and
  ([.images[].name] | sort == ["agent", "backup", "migrator", "web"])
' "$manifest" >/dev/null || fail "manifest validation failed"

release_tag=$(jq -er '.release_tag' "$manifest")
source_commit=$(jq -er '.source_commit' "$manifest")
release_version=$(jq -er '.release_version' "$manifest")
migration_version=$(jq -er '.migration_version' "$manifest")
web_image=$(jq -er '.images[] | select(.name == "web") | .image_ref' "$manifest")
migrator_image=$(jq -er '.images[] | select(.name == "migrator") | .image_ref' "$manifest")
backup_image=$(jq -er '.images[] | select(.name == "backup") | .image_ref' "$manifest")
agent_image=$(jq -er '.images[] | select(.name == "agent") | .image_ref' "$manifest")

validate_image() {
  value=$1
  repository=$2
  printf '%s\n' "$value" | grep -Eq "^ghcr.io/super-erp/${repository}@sha256:[0-9a-f]{64}$" ||
    fail "invalid ${repository} image"
}
validate_image "$web_image" crm-web
validate_image "$migrator_image" crm-migrator
validate_image "$backup_image" crm-backup
validate_image "$agent_image" crm-deployment-agent

set_value() {
  key=$1
  value=$2
  temporary=$(mktemp "${env_file}.XXXXXX")
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$env_file" > "$temporary"
  chmod 0600 "$temporary"
  mv "$temporary" "$env_file"
}

set_value RELEASE_TAG "$release_tag"
set_value SOURCE_COMMIT_SHA "$source_commit"
set_value WEB_IMAGE "$web_image"
set_value MIGRATOR_IMAGE "$migrator_image"
set_value BACKUP_IMAGE "$backup_image"
set_value AGENT_IMAGE "$agent_image"
set_value APPLICATION_VERSION "$release_version"
set_value MIGRATION_VERSION "$migration_version"
set_value AGENT_VERSION "$release_version"

echo "release manifest applied: $release_tag"
