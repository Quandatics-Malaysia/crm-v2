#!/bin/sh

set -eu

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
trap 'exit 1' HUP INT TERM

fixture_count=0
new_fixture() {
  fixture_count=$((fixture_count + 1))
  fixture="$scratch/fixture-$fixture_count"
  mkdir -p "$fixture/apps/web/.next/static/chunks" \
    "$fixture/apps/web/public" \
    "$fixture/node_modules/postgres/src" \
    "$fixture/packages/control-protocol/dist" \
    "$fixture/packages/control-protocol/node_modules/zod"
  touch "$fixture/apps/web/server.js" \
    "$fixture/apps/web/package.json" \
    "$fixture/apps/web/.next/static/chunks/main.js" \
    "$fixture/apps/web/public/logo.svg" \
    "$fixture/node_modules/postgres/package.json" \
    "$fixture/node_modules/postgres/src/index.js" \
    "$fixture/node_modules/postgres/README.md" \
    "$fixture/packages/control-protocol/package.json" \
    "$fixture/packages/control-protocol/dist/index.js" \
    "$fixture/packages/control-protocol/dist/runtime.json" \
    "$fixture/packages/control-protocol/node_modules/zod/package.json" \
    "$fixture/packages/control-protocol/node_modules/zod/index.js"
}

new_fixture
touch "$fixture/apps/web/leak.ts"

if scripts/check-runtime-artifacts.sh "$fixture"; then
  echo "expected TypeScript leak to fail" >&2
  exit 1
fi

rm "$fixture/apps/web/leak.ts"
scripts/check-runtime-artifacts.sh "$fixture"

export_root="$scratch/export-root"
mkdir -p "$export_root/app" \
  "$export_root/root" \
  "$export_root/workspace" \
  "$export_root/var/lib/stray/.git"
mv "$fixture/apps" "$fixture/node_modules" "$fixture/packages" "$export_root/app/"
touch "$export_root/root/.npmrc" \
  "$export_root/workspace/source.ts" \
  "$export_root/var/lib/stray/.git/config"
if scripts/check-runtime-artifacts.sh "$export_root"; then
  echo "expected forbidden artifacts outside /app to fail" >&2
  exit 1
fi

metadata_failures=0
assert_external_metadata_rejected() {
  artifact=$1
  new_fixture
  private_metadata_root="$scratch/private-metadata-export-$fixture_count"
  mkdir -p "$private_metadata_root/app" \
    "$(dirname "$private_metadata_root/$artifact")"
  mv "$fixture/apps" "$fixture/node_modules" "$fixture/packages" \
    "$private_metadata_root/app/"
  touch "$private_metadata_root/$artifact"
  if scripts/check-runtime-artifacts.sh "$private_metadata_root"; then
    echo "expected $artifact outside /app to fail" >&2
    metadata_failures=$((metadata_failures + 1))
  fi
}

for artifact in \
  workspace/tests/test.js \
  root/docs/private.md \
  opt/fixtures/customer.json
do
  assert_external_metadata_rejected "$artifact"
done

if [ "$metadata_failures" -ne 0 ]; then
  exit 1
fi

assert_rejected() {
  artifact=$1
  new_fixture
  mkdir -p "$(dirname "$fixture/$artifact")"
  touch "$fixture/$artifact"

  if scripts/check-runtime-artifacts.sh "$fixture"; then
    echo "expected $artifact to fail" >&2
    exit 1
  fi
}

for artifact in \
  .git/config \
  .github/workflows/release.yml \
  .superpowers/review.md \
  OPERATIONS.md \
  apps/web/leak.tsx \
  apps/web/leak.map \
  apps/web/leak.test.js \
  apps/web/component.jsx \
  apps/web/.env \
  apps/web/.env.production \
  .npmrc \
  .aws/credentials \
  .docker/config.json \
  .ssh/id_rsa \
  deploy/private.key \
  tests/fixture.js \
  fixtures/customer.json \
  docs/private.md \
  docs-site/private.md
do
  assert_rejected "$artifact"
done

assert_rejected internal-source.js
assert_rejected packages/private/internal-source.js

new_fixture
rm -rf "$fixture/packages/control-protocol"
touch "$fixture/packages/control-protocol"
if scripts/check-runtime-artifacts.sh "$fixture"; then
  echo "expected non-directory runtime package to fail" >&2
  exit 1
fi

new_fixture
mkdir -p "$fixture/apps/web/.next/server"
printf '%s\n' '-----BEGIN PRIVATE KEY-----' 'test-only-key-material' \
  > "$fixture/apps/web/.next/server/server.pem"
if scripts/check-runtime-artifacts.sh "$fixture"; then
  echo "expected embedded private key material to fail" >&2
  exit 1
fi

new_fixture
mkdir -p "$fixture/apps/web/.next/server"
touch "$fixture/apps/web/.next/server/credentials.json"
if scripts/check-runtime-artifacts.sh "$fixture"; then
  echo "expected embedded credentials file to fail" >&2
  exit 1
fi

new_fixture
mkdir -p "$fixture/app/db/migrations/meta" "$fixture/app/db/sql"
touch "$fixture/app/migrate.mjs" \
  "$fixture/app/seed.mjs" \
  "$fixture/app/db/migrations/0000_init.sql" \
  "$fixture/app/db/migrations/meta/_journal.json" \
  "$fixture/app/db/sql/rls.sql"
scripts/check-runtime-artifacts.sh "$fixture/app"

touch "$fixture/app/db/migrations/raw-helper.js"
if scripts/check-runtime-artifacts.sh "$fixture/app"; then
  echo "expected non-migration migrator asset to fail" >&2
  exit 1
fi

unknown_root="$scratch/unknown-runtime"
mkdir -p "$unknown_root/app"
touch "$unknown_root/app/payload.bin"
if scripts/check-runtime-artifacts.sh "$unknown_root"; then
  echo "expected unknown client runtime layout to fail" >&2
  exit 1
fi

if scripts/check-runtime-artifacts.sh; then
  echo "expected missing root to fail" >&2
  exit 1
fi

assert_root_alias_rejected() {
  unsafe_root=$1
  if output=$(scripts/check-runtime-artifacts.sh "$unsafe_root" 2>&1); then
    echo "expected root alias $unsafe_root to fail" >&2
    exit 1
  fi
  case "$output" in
    *"refusing filesystem root"*) ;;
    *)
      echo "expected canonical root rejection for $unsafe_root, got: $output" >&2
      exit 1
      ;;
  esac
}

assert_root_alias_rejected /
assert_root_alias_rejected //
assert_root_alias_rejected /.

root_alias="$scratch/root-alias"
ln -s / "$root_alias"
assert_root_alias_rejected "$root_alias"
