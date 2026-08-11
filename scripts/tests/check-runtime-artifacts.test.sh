#!/bin/sh

set -eu

fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/apps/web"
touch "$fixture/apps/web/server.js" "$fixture/apps/web/leak.ts"

if scripts/check-runtime-artifacts.sh "$fixture"; then
  echo "expected TypeScript leak to fail" >&2
  exit 1
fi

rm "$fixture/apps/web/leak.ts"
scripts/check-runtime-artifacts.sh "$fixture"

assert_rejected() {
  artifact=$1
  fixture=$(mktemp -d)
  trap 'rm -rf "$fixture"' EXIT

  mkdir -p "$fixture/apps/web"
  case "$artifact" in
    .git|tests|fixtures|docs|docs-site)
      mkdir -p "$fixture/$artifact"
      touch "$fixture/$artifact/private-file"
      ;;
    *)
      touch "$fixture/apps/web/$artifact"
      ;;
  esac

  if scripts/check-runtime-artifacts.sh "$fixture"; then
    echo "expected $artifact to fail" >&2
    exit 1
  fi

  rm -rf "$fixture"
  trap - EXIT
}

for artifact in .git leak.tsx leak.map leak.test.js .env .env.production tests fixtures docs docs-site; do
  assert_rejected "$artifact"
done

if scripts/check-runtime-artifacts.sh; then
  echo "expected missing root to fail" >&2
  exit 1
fi

if scripts/check-runtime-artifacts.sh /; then
  echo "expected root filesystem to fail" >&2
  exit 1
fi
