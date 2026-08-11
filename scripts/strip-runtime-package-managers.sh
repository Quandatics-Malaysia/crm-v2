#!/bin/sh

set -eu

root=${1:-}
mode=${2:-}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ] || [ -z "$root" ] || [ ! -d "$root" ]; then
  echo "usage: $0 <runtime-root> [--container-root]" >&2
  exit 1
fi

canonical_root=$(
  CDPATH=
  export CDPATH
  cd -P "$root" 2>/dev/null
  pwd -P
)

if [ "$canonical_root" = "/" ] && [ "$mode" != "--container-root" ]; then
  echo "refusing filesystem root without --container-root" >&2
  exit 1
fi

if [ -n "$mode" ] && { [ "$mode" != "--container-root" ] || [ "$canonical_root" != "/" ]; }; then
  echo "usage: $0 <runtime-root> [--container-root]" >&2
  exit 1
fi

remove_runtime_path() {
  relative_path=$1
  if [ "$canonical_root" = "/" ]; then
    target="/$relative_path"
  else
    target="$canonical_root/$relative_path"
  fi
  rm -rf -- "$target"
}

for runtime_path in \
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
  remove_runtime_path "$runtime_path"
done
