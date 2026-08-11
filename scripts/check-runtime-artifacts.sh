#!/bin/sh

set -eu

root=${1:-}

if [ "$#" -ne 1 ] || [ -z "$root" ] || [ ! -d "$root" ]; then
  echo "usage: $0 <exported-runtime-root>" >&2
  exit 1
fi

canonical_root=$(
  CDPATH=
  export CDPATH
  cd -P "$root" 2>/dev/null
  pwd -P
)

case "$canonical_root" in
  /|//)
    echo "refusing filesystem root: $root" >&2
    exit 1
    ;;
esac

payload_root=$canonical_root
if [ -d "$canonical_root/app" ]; then
  payload_root="$canonical_root/app"
fi

forbidden=$(find "$canonical_root" \( \
  -name .git -o \
  -name .github -o \
  -name .superpowers -o \
  -name '*.ts' -o \
  -name '*.tsx' -o \
  -name '*.jsx' -o \
  -name '*.map' -o \
  -name '*.test.*' -o \
  -name '*.spec.*' -o \
  -name .env -o \
  -name '.env.*' -o \
  -name .npmrc -o \
  -name .yarnrc -o \
  -name .pnpmrc -o \
  -name credentials -o \
  -name credentials.json -o \
  -path '*/.docker/config.json' -o \
  -name id_rsa -o \
  -name id_ed25519 -o \
  -name '*.key' -o \
  -name '*.p12' -o \
  -name '*.pfx' -o \
  -name '*private*.pem' \
\) -print -quit)

if [ -n "$forbidden" ]; then
  echo "forbidden runtime artifact: $forbidden" >&2
  exit 1
fi

forbidden=$(find "$payload_root" \( \
  -name test -o \
  -name tests -o \
  -name __tests__ -o \
  -name fixtures -o \
  -name docs -o \
  -name docs-site -o \
  -name OPERATIONS.md \
\) -print -quit)

if [ -n "$forbidden" ]; then
  echo "forbidden runtime artifact: $forbidden" >&2
  exit 1
fi

private_key=$(find "$canonical_root" -type f -size -1048576c \
  -exec grep -l -- '-----BEGIN .*PRIVATE KEY-----' {} + 2>/dev/null \
  | sed -n '1p')

if [ -n "$private_key" ]; then
  echo "private key material in runtime artifact: $private_key" >&2
  exit 1
fi

if [ -f "$payload_root/migrate.mjs" ]; then
  unexpected=$(find "$payload_root" -mindepth 1 -maxdepth 1 \
    ! -name migrate.mjs \
    ! -name seed.mjs \
    ! -name db \
    ! -name node_modules \
    ! -name package.json \
    -print -quit)

  if [ -z "$unexpected" ] && [ -d "$payload_root/db" ]; then
    unexpected=$(find "$payload_root/db" -mindepth 1 -maxdepth 1 \
      ! -name migrations \
      ! -name sql \
      -print -quit)
  fi

  if [ -z "$unexpected" ] && [ -d "$payload_root/db/migrations" ]; then
    unexpected=$(find "$payload_root/db/migrations" -type f \
      ! -name '*.sql' \
      ! -path '*/meta/*.json' \
      -print -quit)
  fi

  if [ -z "$unexpected" ] && [ -d "$payload_root/db/sql" ]; then
    unexpected=$(find "$payload_root/db/sql" -type f ! -name '*.sql' -print -quit)
  fi

  if [ -n "$unexpected" ]; then
    echo "unexpected migrator artifact: $unexpected" >&2
    exit 1
  fi
elif [ -f "$payload_root/apps/web/server.js" ]; then
  unexpected=$(find "$payload_root" -mindepth 1 -maxdepth 1 \
    ! -name apps \
    ! -name node_modules \
    ! -name packages \
    ! -name package.json \
    -print -quit)

  if [ -z "$unexpected" ]; then
    unexpected=$(find "$payload_root/apps" -mindepth 1 -maxdepth 1 \
      ! -name web \
      -print -quit)
  fi

  if [ -z "$unexpected" ]; then
    unexpected=$(find "$payload_root/apps/web" -mindepth 1 -maxdepth 1 \
      ! -name server.js \
      ! -name package.json \
      ! -name .next \
      ! -name public \
      ! -name node_modules \
      -print -quit)
  fi

  if [ -z "$unexpected" ] && [ -d "$payload_root/packages" ]; then
    unexpected=$(find "$payload_root/packages" -mindepth 1 -maxdepth 1 \
      \( ! -name control-protocol -o ! -type d \) \
      -print -quit)
  fi

  package_root="$payload_root/packages/control-protocol"
  if [ -z "$unexpected" ] && [ -d "$package_root" ]; then
    unexpected=$(find "$package_root" -mindepth 1 -maxdepth 1 \
      ! -name package.json \
      ! -name dist \
      ! -name node_modules \
      -print -quit)
  fi

  if [ -z "$unexpected" ] && [ -d "$package_root/dist" ]; then
    unexpected=$(find "$package_root/dist" -type f \
      ! -name '*.js' \
      ! -name '*.mjs' \
      ! -name '*.cjs' \
      ! -name '*.json' \
      ! -name '*.node' \
      ! -name '*.wasm' \
      -print -quit)
  fi

  if [ -n "$unexpected" ]; then
    echo "unexpected web runtime artifact: $unexpected" >&2
    exit 1
  fi
else
  echo "unrecognized client runtime layout: $payload_root" >&2
  exit 1
fi
