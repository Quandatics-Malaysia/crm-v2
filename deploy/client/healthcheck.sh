#!/bin/sh
set -eu

healthcheck_url=${HEALTHCHECK_URL:-http://127.0.0.1:8081/api/health}
attempts=${HEALTHCHECK_ATTEMPTS:-30}
interval_seconds=${HEALTHCHECK_INTERVAL_SECONDS:-2}
timeout_seconds=${HEALTHCHECK_TIMEOUT_SECONDS:-5}

fail() {
  echo "healthcheck: $*" >&2
  exit 1
}

printf '%s\n' "$healthcheck_url" | grep -Eq '^http://127\.0\.0\.1:[0-9]+/api/health$' ||
  fail "HEALTHCHECK_URL must be exactly http://127.0.0.1:<port>/api/health"
healthcheck_port=${healthcheck_url#http://127.0.0.1:}
healthcheck_port=${healthcheck_port%/api/health}
case "$healthcheck_port" in
  ''|*[!0-9]*|0) fail "health-check port must be between 1 and 65535" ;;
esac
[ "${#healthcheck_port}" -le 5 ] || fail "health-check port must be between 1 and 65535"
[ "$healthcheck_port" -le 65535 ] || fail "health-check port must be between 1 and 65535"

case "$attempts" in
  ''|*[!0-9]*|0) fail "HEALTHCHECK_ATTEMPTS must be a positive integer" ;;
esac
case "$interval_seconds" in
  ''|*[!0-9]*) fail "HEALTHCHECK_INTERVAL_SECONDS must be a non-negative integer" ;;
esac
case "$timeout_seconds" in
  ''|*[!0-9]*|0) fail "HEALTHCHECK_TIMEOUT_SECONDS must be a positive integer" ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl is required"

attempt=1
while [ "$attempt" -le "$attempts" ]; do
  if (
    unset http_proxy https_proxy all_proxy no_proxy
    unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
    curl --disable --noproxy '*' --fail --silent --show-error --max-time "$timeout_seconds" "$healthcheck_url" >/dev/null 2>&1
  ); then
    echo "health check passed: $healthcheck_url"
    exit 0
  fi
  [ "$attempt" -eq "$attempts" ] || sleep "$interval_seconds"
  attempt=$((attempt + 1))
done

fail "health check failed after $attempts attempts: $healthcheck_url"
