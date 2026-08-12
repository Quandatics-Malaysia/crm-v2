#!/bin/sh

set -eu

uid=$(id -u)
if [ "$uid" -ne 10001 ]; then
  echo "backup runtime must run as uid 10001, got: $uid" >&2
  exit 1
fi

postgres_version=$(pg_dump --version)
case "$postgres_version" in
  *" 17."*) ;;
  *)
    echo "expected PostgreSQL 17 pg_dump, got: $postgres_version" >&2
    exit 1
    ;;
esac

age_version=$(age --version)
case "$age_version" in
  *"1.3.1"*) ;;
  *)
    echo "expected age 1.3.1, got: $age_version" >&2
    exit 1
    ;;
esac

rclone_version=$(rclone version | sed -n '1p')
case "$rclone_version" in
  *"v1.74.4"*) ;;
  *)
    echo "expected rclone 1.74.4, got: $rclone_version" >&2
    exit 1
    ;;
esac

package_version() {
  awk -v package="$1" '
    $0 == "P:" package { found = 1; next }
    found && /^V:/ { sub(/^V:/, ""); print; exit }
    /^$/ { found = 0 }
  ' /lib/apk/db/installed
}

for package_pin in \
  ca-certificates=20260611-r0 \
  libpq=18.4-r0 \
  libncursesw=6.5_p20251123-r0 \
  lz4-libs=1.10.0-r0 \
  ncurses-terminfo-base=6.5_p20251123-r0 \
  postgresql-common=1.2-r2 \
  postgresql17-client=17.10-r0 \
  readline=8.3.1-r0 \
  tzdata=2026c-r0 \
  zstd-libs=1.5.7-r2
do
  package=${package_pin%%=*}
  expected=${package_pin#*=}
  actual=$(package_version "$package")
  if [ "$actual" != "$expected" ]; then
    echo "expected $package $expected, got: ${actual:-missing}" >&2
    exit 1
  fi
done

postgres_semver=${postgres_version##* }
age_semver=${age_version#v}
rclone_semver=${rclone_version#rclone v}

printf 'uid=%s postgresql=%s age=%s rclone=%s packages=pinned\n' \
  "$uid" "$postgres_semver" "$age_semver" "$rclone_semver"
