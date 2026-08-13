#!/bin/sh
set -eu

# Trust boundary. Change these constants together only when repository ownership
# or release workflow identity is intentionally migrated.
SIGNING_REPOSITORY=Super-ERP/crm-v2
SIGNING_WORKFLOW=release-images.yml
OIDC_ISSUER=https://token.actions.githubusercontent.com
WEB_REPOSITORY=ghcr.io/super-erp/crm-web
MIGRATOR_REPOSITORY=ghcr.io/super-erp/crm-migrator
BACKUP_REPOSITORY=ghcr.io/super-erp/crm-backup
AGENT_REPOSITORY=ghcr.io/super-erp/crm-deployment-agent

fail() {
  echo "verify-images: $*" >&2
  exit 1
}

validate_release_tag() {
  printf '%s\n' "$1" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$' ||
    fail "RELEASE_TAG must be an immutable release tag such as v1.2.3"
}

validate_vendor_image() {
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

[ -n "${RELEASE_TAG:-}" ] || fail "RELEASE_TAG is required"
[ -n "${WEB_IMAGE:-}" ] || fail "WEB_IMAGE is required"
[ -n "${MIGRATOR_IMAGE:-}" ] || fail "MIGRATOR_IMAGE is required"
[ -n "${BACKUP_IMAGE:-}" ] || fail "BACKUP_IMAGE is required"
[ -n "${AGENT_IMAGE:-}" ] || fail "AGENT_IMAGE is required"

validate_release_tag "$RELEASE_TAG"
validate_vendor_image WEB_IMAGE "$WEB_IMAGE" "$WEB_REPOSITORY"
validate_vendor_image MIGRATOR_IMAGE "$MIGRATOR_IMAGE" "$MIGRATOR_REPOSITORY"
validate_vendor_image BACKUP_IMAGE "$BACKUP_IMAGE" "$BACKUP_REPOSITORY"
validate_vendor_image AGENT_IMAGE "$AGENT_IMAGE" "$AGENT_REPOSITORY"

if ! command -v cosign >/dev/null 2>&1; then
  fail "cosign is required but not installed; use the pinned, checksum-verified installation in README.md"
fi

certificate_identity="https://github.com/$SIGNING_REPOSITORY/.github/workflows/$SIGNING_WORKFLOW@refs/tags/$RELEASE_TAG"

for image_reference in "$WEB_IMAGE" "$MIGRATOR_IMAGE" "$BACKUP_IMAGE" "$AGENT_IMAGE"; do
  if ! cosign verify \
    --certificate-identity "$certificate_identity" \
    --certificate-oidc-issuer "$OIDC_ISSUER" \
    "$image_reference" >/dev/null; then
    fail "signature verification failed for $image_reference"
  fi
done

echo "verified vendor image signatures for $RELEASE_TAG"
