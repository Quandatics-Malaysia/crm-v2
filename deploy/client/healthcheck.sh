#!/bin/sh
set -eu

healthcheck_url=${HEALTHCHECK_URL:-http://127.0.0.1:8081/api/health}
attempts=${HEALTHCHECK_ATTEMPTS:-30}
interval_seconds=${HEALTHCHECK_INTERVAL_SECONDS:-2}
timeout_seconds=${HEALTHCHECK_TIMEOUT_SECONDS:-5}

case "$attempts" in
  ''|*[!0-9]*|0) echo "healthcheck: HEALTHCHECK_ATTEMPTS must be a positive integer" >&2; exit 1 ;;
esac
case "$interval_seconds" in
  ''|*[!0-9]*) echo "healthcheck: HEALTHCHECK_INTERVAL_SECONDS must be a non-negative integer" >&2; exit 1 ;;
esac
case "$timeout_seconds" in
  ''|*[!0-9]*|0) echo "healthcheck: HEALTHCHECK_TIMEOUT_SECONDS must be a positive integer" >&2; exit 1 ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "healthcheck: curl is required" >&2
  exit 1
fi

attempt=1
while [ "$attempt" -le "$attempts" ]; do
  if curl --fail --silent --show-error --max-time "$timeout_seconds" "$healthcheck_url" >/dev/null 2>&1; then
    echo "health check passed: $healthcheck_url"
    exit 0
  fi
  [ "$attempt" -eq "$attempts" ] || sleep "$interval_seconds"
  attempt=$((attempt + 1))
done

echo "health check failed after $attempts attempts: $healthcheck_url" >&2
exit 1
