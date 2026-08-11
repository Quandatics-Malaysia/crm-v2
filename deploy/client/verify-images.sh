#!/bin/sh
set -eu

# Trust boundary. Change these constants together only when repository ownership
# or release workflow identity is intentionally migrated.
SIGNING_REPOSITORY=Quandatics-Malaysia/crm-v2
SIGNING_WORKFLOW=release-images.yml
OIDC_ISSUER=https://token.actions.githubusercontent.com
VENDOR_IMAGE_PREFIX=ghcr.io/quandatics-malaysia/

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

  printf '%s\n' "$image_reference" | grep -Eq '^[a-z0-9.-]+(:[0-9]+)?/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$' ||
    fail "$variable_name must be an immutable sha256 digest reference"
  case "$image_reference" in
    "$VENDOR_IMAGE_PREFIX"*) ;;
    *) fail "$variable_name must use vendor registry namespace $VENDOR_IMAGE_PREFIX" ;;
  esac
}

[ -n "${RELEASE_TAG:-}" ] || fail "RELEASE_TAG is required"
[ -n "${WEB_IMAGE:-}" ] || fail "WEB_IMAGE is required"
[ -n "${MIGRATOR_IMAGE:-}" ] || fail "MIGRATOR_IMAGE is required"
[ -n "${BACKUP_IMAGE:-}" ] || fail "BACKUP_IMAGE is required"

validate_release_tag "$RELEASE_TAG"
validate_vendor_image WEB_IMAGE "$WEB_IMAGE"
validate_vendor_image MIGRATOR_IMAGE "$MIGRATOR_IMAGE"
validate_vendor_image BACKUP_IMAGE "$BACKUP_IMAGE"

if ! command -v cosign >/dev/null 2>&1; then
  fail "cosign is required but not installed; use the pinned, checksum-verified installation in README.md"
fi

certificate_identity="https://github.com/$SIGNING_REPOSITORY/.github/workflows/$SIGNING_WORKFLOW@refs/tags/$RELEASE_TAG"

for image_reference in "$WEB_IMAGE" "$MIGRATOR_IMAGE" "$BACKUP_IMAGE"; do
  if ! cosign verify \
    --certificate-identity "$certificate_identity" \
    --certificate-oidc-issuer "$OIDC_ISSUER" \
    "$image_reference" >/dev/null; then
    fail "signature verification failed for $image_reference"
  fi
done

echo "verified vendor image signatures for $RELEASE_TAG"
