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

# Mirror package-manager artifacts shipped by the real node:22-alpine base plus
# the globally pinned pnpm layer. The client runner must strip them before its
# full filesystem is checked.
new_fixture
base_runtime="$scratch/base-runtime"
mkdir -p "$base_runtime/app" \
  "$base_runtime/usr/bin" \
  "$base_runtime/usr/local/bin" \
  "$base_runtime/usr/local/lib/node_modules/corepack" \
  "$base_runtime/usr/local/lib/node_modules/npm/docs" \
  "$base_runtime/usr/local/lib/node_modules/npm/node_modules/glob/dist/commonjs" \
  "$base_runtime/usr/local/lib/node_modules/pnpm" \
  "$base_runtime/opt/yarn-v1.22.22" \
  "$base_runtime/root/.npm" \
  "$base_runtime/tmp/node-compile-cache/v22"
mv "$fixture/apps" "$fixture/node_modules" "$fixture/packages" "$base_runtime/app/"
touch "$base_runtime/usr/bin/test" \
  "$base_runtime/usr/local/bin/corepack" \
  "$base_runtime/usr/local/bin/npm" \
  "$base_runtime/usr/local/bin/npx" \
  "$base_runtime/usr/local/bin/pn" \
  "$base_runtime/usr/local/bin/pnpm" \
  "$base_runtime/usr/local/bin/pnpx" \
  "$base_runtime/usr/local/bin/pnx" \
  "$base_runtime/usr/local/bin/yarn" \
  "$base_runtime/usr/local/bin/yarnpkg" \
  "$base_runtime/usr/local/lib/node_modules/npm/docs/content.md" \
  "$base_runtime/usr/local/lib/node_modules/npm/node_modules/glob/dist/commonjs/glob.d.ts" \
  "$base_runtime/usr/local/lib/node_modules/npm/node_modules/glob/dist/commonjs/glob.js.map" \
  "$base_runtime/root/.npm/_update-notifier-last-checked"
printf '%s\n' '-----BEGIN PRIVATE KEY-----' \
  > "$base_runtime/tmp/node-compile-cache/v22/compiled-pnpm-cache"

scripts/strip-runtime-package-managers.sh "$base_runtime"
scripts/check-runtime-artifacts.sh "$base_runtime"

for manager_path in \
  usr/local/bin/corepack \
  usr/local/bin/npm \
  usr/local/bin/npx \
  usr/local/bin/pn \
  usr/local/bin/pnpm \
  usr/local/bin/pnpx \
  usr/local/bin/pnx \
  usr/local/bin/yarn \
  usr/local/bin/yarnpkg \
  usr/local/lib/node_modules/corepack \
  usr/local/lib/node_modules/npm \
  usr/local/lib/node_modules/pnpm \
  opt/yarn-v1.22.22 \
  root/.npm \
  tmp/node-compile-cache
do
  if [ -e "$base_runtime/$manager_path" ] || [ -L "$base_runtime/$manager_path" ]; then
    echo "expected build-tool artifact $manager_path to be stripped" >&2
    exit 1
  fi
done

new_fixture
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

backup_root="$scratch/backup-runtime"
mkdir -p "$backup_root/opt/backup" \
  "$backup_root/usr/bin" \
  "$backup_root/usr/local/bin" \
  "$backup_root/var/lib/backup"
touch "$backup_root/opt/backup/check-tools.sh" \
  "$backup_root/usr/bin/pg_dump" \
  "$backup_root/usr/local/bin/age" \
  "$backup_root/usr/local/bin/rclone"
chmod 0555 "$backup_root/opt/backup/check-tools.sh" \
  "$backup_root/usr/bin/pg_dump" \
  "$backup_root/usr/local/bin/age" \
  "$backup_root/usr/local/bin/rclone"
scripts/check-runtime-artifacts.sh "$backup_root"

touch "$backup_root/opt/backup/build-notes.md"
if scripts/check-runtime-artifacts.sh "$backup_root"; then
  echo "expected non-operational backup payload to fail" >&2
  exit 1
fi
rm "$backup_root/opt/backup/build-notes.md"

mkdir -p "$backup_root/sbin"
touch "$backup_root/sbin/apk"
if scripts/check-runtime-artifacts.sh "$backup_root"; then
  echo "expected backup runtime package manager to fail" >&2
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
