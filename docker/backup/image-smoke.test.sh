#!/bin/sh

set -eu

image=${1:-}

if [ "$#" -ne 1 ] || [ -z "$image" ]; then
  echo "usage: $0 <backup-image>" >&2
  exit 1
fi

scratch=$(mktemp -d)
container=
cleanup() {
  if [ -n "$container" ]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  chmod -R u+w "$scratch" 2>/dev/null || true
  rm -rf "$scratch"
}
trap cleanup EXIT HUP INT TERM

versions=$(docker run --rm --entrypoint /opt/backup/check-tools.sh "$image")

case "$versions" in
  *"uid=10001"*"postgresql=17.10"*"age=1.2.1"*"rclone=1.75.0"*"packages=pinned"*) ;;
  *)
    echo "unexpected backup tool report: $versions" >&2
    exit 1
    ;;
esac

configured_user=$(docker image inspect --format '{{.Config.User}}' "$image")
if [ "$configured_user" != "10001:10001" ]; then
  echo "backup image must configure user 10001:10001, got: $configured_user" >&2
  exit 1
fi

if docker run --rm --entrypoint sh "$image" -c 'command -v apk >/dev/null 2>&1'; then
  echo "backup image must not contain a package manager" >&2
  exit 1
fi

container=$(docker create "$image")
docker export "$container" > "$scratch/rootfs.tar"
mkdir "$scratch/rootfs"
tar -xf "$scratch/rootfs.tar" -C "$scratch/rootfs"
scripts/check-runtime-artifacts.sh "$scratch/rootfs"

echo "backup image smoke passed: $versions"
