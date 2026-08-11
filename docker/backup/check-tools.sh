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
  *"v1.74.2"*) ;;
  *)
    echo "expected rclone 1.74.2, got: $rclone_version" >&2
    exit 1
    ;;
esac

postgres_semver=${postgres_version##* }
age_semver=${age_version#v}
rclone_semver=${rclone_version#rclone v}

printf 'uid=%s postgresql=%s age=%s rclone=%s\n' \
  "$uid" "$postgres_semver" "$age_semver" "$rclone_semver"
