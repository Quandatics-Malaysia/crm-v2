#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/release-one-command.sh --bump <patch|minor|major> [--wait]
  scripts/release-one-command.sh --tag <vX.Y.Z> [--wait]

Options:
  --bump, -b      Next version increment from latest stable tag
  --tag, -t       Explicit tag to create (must be annotated semver)
  --wait, -w      Wait for release-images workflow completion
  --no-log         Skip appending to docs/operations/release-log.md
  --help, -h      Show this help

Examples:
  scripts/release-one-command.sh --bump patch --wait
  scripts/release-one-command.sh --tag v1.2.15 --wait
EOF
}

REPO="Super-ERP/crm-v2"
RELEASE_WORKFLOW="release-images.yml"
LOG_FILE="docs/operations/release-log.md"

BUMP_MODE=""
TAG=""
WAIT_AFTER_PUSH=0
SKIP_LOG=0

require_cmd() {
  local cmd=$1
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "required command not found: $cmd" >&2
    exit 1
  }
}

require_cmd git
require_cmd gh
require_cmd jq

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bump|-b)
      BUMP_MODE=$2
      shift 2
      ;;
    --tag|-t)
      TAG=$2
      shift 2
      ;;
    --wait|-w)
      WAIT_AFTER_PUSH=1
      shift
      ;;
    --no-log)
      SKIP_LOG=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ -z "$BUMP_MODE" ] && [ -z "$TAG" ]; then
  echo "error: set --bump or --tag" >&2
  usage
  exit 1
fi

if [ -n "$BUMP_MODE" ]; then
  if [ "$BUMP_MODE" != "patch" ] && [ "$BUMP_MODE" != "minor" ] && [ "$BUMP_MODE" != "major" ]; then
    echo "error: --bump must be patch, minor, or major" >&2
    exit 1
  fi

  BASE_TAG=$(git tag --list --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1 || true)
  if [ -z "$BASE_TAG" ]; then
    echo "error: no stable release tag found for bump" >&2
    exit 1
  fi
  BASE_CORE=${BASE_TAG#v}
  BASE_MAJOR=$(printf '%s' "$BASE_CORE" | awk -F. '{print $1}')
  BASE_MINOR=$(printf '%s' "$BASE_CORE" | awk -F. '{print $2}')
  BASE_PATCH=$(printf '%s' "$BASE_CORE" | awk -F. '{print $3}')

  case "$BUMP_MODE" in
    patch)
      NEXT_PATCH=$((BASE_PATCH + 1))
      NEXT_TAG="v${BASE_MAJOR}.${BASE_MINOR}.${NEXT_PATCH}"
      ;;
    minor)
      NEXT_MINOR=$((BASE_MINOR + 1))
      NEXT_TAG="v${BASE_MAJOR}.${NEXT_MINOR}.0"
      ;;
    major)
      NEXT_MAJOR=$((BASE_MAJOR + 1))
      NEXT_TAG="v${NEXT_MAJOR}.0.0"
      ;;
  esac

  TAG="$NEXT_TAG"
fi

if [ -z "$TAG" ]; then
  echo "error: failed to compute tag" >&2
  exit 1
fi

if ! printf '%s' "$TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "error: invalid tag format: $TAG" >&2
  echo "expected: v1.2.3" >&2
  exit 1
fi

if git tag -l "$TAG" >/dev/null | grep -qx "$TAG"; then
  echo "error: tag already exists: $TAG" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty; commit or stash changes first" >&2
  exit 1
fi

if [ "$(git branch --show-current)" != "main" ]; then
  echo "error: releases must run from main" >&2
  exit 1
fi

git fetch origin main --tags --quiet
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "error: local main must exactly match origin/main" >&2
  exit 1
fi

WORKING_SHA=$(git rev-parse HEAD)
echo "creating annotated tag $TAG at $WORKING_SHA"
git tag -a "$TAG" -m "release $TAG"

echo "pushing $TAG"
git push origin "$TAG"

echo "starting $RELEASE_WORKFLOW for $TAG"
gh workflow run "$RELEASE_WORKFLOW" --repo "$REPO" --ref "$TAG" -f "ref=$TAG"

if [ "$WAIT_AFTER_PUSH" -eq 0 ]; then
  echo "release workflow started."
  echo "to wait for the pipeline run: rtk gh run list --workflow $RELEASE_WORKFLOW"
  echo "playground check later: https://app.quandatics.com/api-playground"
  exit 0
fi

echo "waiting for release-images workflow on $TAG"
for ATTEMPT in $(seq 1 120); do
  RUN_JSON=$(gh run list --workflow "$RELEASE_WORKFLOW" --limit 20 --json databaseId,headSha,headBranch,status,conclusion,createdAt,name 2>/dev/null || echo '[]')
  RUN_ID=$(printf '%s\n' "$RUN_JSON" | jq -r --arg sha "$WORKING_SHA" --arg tag "$TAG" '
    map(select(.name == "release-images" and .headSha == $sha and .headBranch == $tag))
    | sort_by(.createdAt)
    | last
    | .databaseId
  ')
  if [ -n "$RUN_ID" ] && [ "$RUN_ID" != "null" ]; then
    break
  fi
  sleep 5
done

if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "null" ]; then
  echo "error: could not find release-images run for $TAG ($WORKING_SHA)" >&2
  exit 1
fi

while true; do
  RUN_STATUS=$(gh run view "$RUN_ID" --json status,conclusion --jq '.status')
  RUN_CONCLUSION=$(gh run view "$RUN_ID" --json status,conclusion --jq '.conclusion')
  echo "release run: status=$RUN_STATUS conclusion=$RUN_CONCLUSION"
  if [ "$RUN_STATUS" = "completed" ]; then
    if [ "$RUN_CONCLUSION" != "success" ]; then
      echo "error: release workflow failed (conclusion=$RUN_CONCLUSION, run=$RUN_ID)" >&2
      exit 1
    fi
    break
  fi
  sleep 10
done

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "downloading release manifest for $TAG"
gh run download "$RUN_ID" --name "release-manifest-${TAG}" --dir "$TMP_DIR"
MANIFEST_FILE="$(find "$TMP_DIR" -name release-manifest.json | head -n 1 || true)"
if [ -z "$MANIFEST_FILE" ] || [ ! -f "$MANIFEST_FILE" ]; then
  echo "error: release-manifest artifact not found" >&2
  exit 1
fi

WEB_IMAGE=$(jq -r '.images[] | select(.name=="web") | .image_ref' "$MANIFEST_FILE")
MIGRATOR_IMAGE=$(jq -r '.images[] | select(.name=="migrator") | .image_ref' "$MANIFEST_FILE")
BACKUP_IMAGE=$(jq -r '.images[] | select(.name=="backup") | .image_ref' "$MANIFEST_FILE")
AGENT_IMAGE=$(jq -r '.images[] | select(.name=="agent") | .image_ref' "$MANIFEST_FILE")
SOURCE_SHA=$(jq -r '.source_commit' "$MANIFEST_FILE")

echo "tag=$TAG"
echo "run_id=$RUN_ID"
echo "web=$WEB_IMAGE"
echo "migrator=$MIGRATOR_IMAGE"
echo "backup=$BACKUP_IMAGE"
echo "agent=$AGENT_IMAGE"

if [ "$SKIP_LOG" -eq 0 ]; then
  mkdir -p "$(dirname "$LOG_FILE")"
  if [ ! -f "$LOG_FILE" ]; then
    cat > "$LOG_FILE" <<'EOF'
# Release log

## Overview

All signed immutable releases are captured from the release manifest artifact.

EOF
  fi
  {
    echo
    echo "## $TAG"
    echo "- released_at_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "- source_sha: $SOURCE_SHA"
    echo "- workflow_run: $RUN_ID"
    echo "- workflow: release-images.yml"
    echo "- web_image: $WEB_IMAGE"
    echo "- migrator_image: $MIGRATOR_IMAGE"
    echo "- backup_image: $BACKUP_IMAGE"
    echo "- agent_image: $AGENT_IMAGE"
    echo
  } >> "$LOG_FILE"
  git add -- "$LOG_FILE"
  git commit -m "docs: record release $TAG"
  git push origin main
fi

echo
echo "release pipeline complete for $TAG"
echo "playground: https://app.quandatics.com/api-playground"
echo "system version page: https://app.quandatics.com/settings/system"
echo "apply on server: copy the images above into deploy/client/.env then run ./deploy/client/deploy.sh ./.env"
