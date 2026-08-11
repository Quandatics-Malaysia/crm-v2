#!/bin/sh

set -eu

root=${1:-}

if [ "$#" -ne 1 ] || [ -z "$root" ] || [ "$root" = "/" ] || [ ! -d "$root" ]; then
  echo "usage: $0 <exported-runtime-root>" >&2
  exit 1
fi

forbidden=$(find "$root" \( \
  -name .git -o \
  -name '*.ts' -o \
  -name '*.tsx' -o \
  -name '*.map' -o \
  -name '*.test.*' -o \
  -name '*.spec.*' -o \
  -name .env -o \
  -name '.env.*' -o \
  -name test -o \
  -name tests -o \
  -name __tests__ -o \
  -name fixtures -o \
  -name docs -o \
  -name docs-site \
\) -print -quit)

if [ -n "$forbidden" ]; then
  echo "forbidden runtime artifact: $forbidden" >&2
  exit 1
fi
