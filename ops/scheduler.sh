#!/bin/sh
# Backup scheduler (foreground) — the backup container's entrypoint. Env is
# inherited by the child scripts (no cron-env pitfalls). Cadence mirrors the
# client's Power Automate schedule:
#   - daily  00:00 UTC → backup.sh          (Full Data export)
#   - weekly Sun 23:00 UTC → weekly-snapshot.sh + verify-restore.sh
set -eu
log() { echo "[scheduler $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
log "started (daily 00:00 UTC, weekly Sun 23:00 UTC)"

LAST_DAILY=""
LAST_WEEKLY=""
while true; do
  DAY=$(date -u +%Y-%m-%d)
  HOUR=$(date -u +%H)
  DOW=$(date -u +%u) # 1=Mon … 7=Sun

  if [ "$HOUR" = "00" ] && [ "$LAST_DAILY" != "$DAY" ]; then
    /ops/backup.sh || log "backup.sh failed"
    LAST_DAILY="$DAY"
  fi

  if [ "$DOW" = "7" ] && [ "$HOUR" = "23" ] && [ "$LAST_WEEKLY" != "$DAY" ]; then
    /ops/weekly-snapshot.sh || log "weekly-snapshot.sh failed"
    /ops/verify-restore.sh  || log "verify-restore.sh failed"
    LAST_WEEKLY="$DAY"
  fi

  sleep 600 # re-check every 10 minutes
done
