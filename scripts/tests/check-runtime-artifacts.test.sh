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
    "$fixture/node_modules/postgres/src"
  touch "$fixture/apps/web/server.js" \
    "$fixture/apps/web/package.json" \
    "$fixture/apps/web/.next/static/chunks/main.js" \
    "$fixture/apps/web/public/logo.svg" \
    "$fixture/node_modules/postgres/package.json" \
    "$fixture/node_modules/postgres/src/index.js" \
    "$fixture/node_modules/postgres/README.md"
}

new_fixture
touch "$fixture/apps/web/leak.ts"

if scripts/check-runtime-artifacts.sh "$fixture"; then
  echo "expected TypeScript leak to fail" >&2
  exit 1
fi

rm "$fixture/apps/web/leak.ts"
scripts/check-runtime-artifacts.sh "$fixture"

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
