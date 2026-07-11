#!/bin/sh
# Backup scheduler (foreground) — the backup container's entrypoint. Env is
# inherited by the child scripts (no cron-env pitfalls). Cadence mirrors the
# client's Power Automate schedule:
#   - daily  00:00 UTC → backup.sh          (Full Data export)
#   - weekly Sun 23:00 UTC → weekly-snapshot.sh + verify-restore.sh
set -eu
log() { echo "[scheduler $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
log "started (daily 00:00 UTC, weekly Sun 23:00 UTC)"

# Optional off-box mirror: set BACKUP_RSYNC_TARGET (e.g. user@nas:/backups/crm)
# to rsync /backups there after every dump. Needs an SSH key + known_hosts
# mounted at /root/.ssh (see docker-compose.yaml). Unset → no-op.
if [ -n "${BACKUP_RSYNC_TARGET:-}" ]; then
  apk add --no-cache rsync openssh-client >/dev/null 2>&1 || log "apk add rsync/ssh failed"
fi
offbox_sync() {
  [ -n "${BACKUP_RSYNC_TARGET:-}" ] || return 0
  rsync -az --delete /backups/ "$BACKUP_RSYNC_TARGET" \
    && log "rsynced /backups → $BACKUP_RSYNC_TARGET" \
    || log "rsync to $BACKUP_RSYNC_TARGET failed"
}

LAST_DAILY=""
LAST_WEEKLY=""
while true; do
  DAY=$(date -u +%Y-%m-%d)
  HOUR=$(date -u +%H)
  DOW=$(date -u +%u) # 1=Mon … 7=Sun

  if [ "$HOUR" = "00" ] && [ "$LAST_DAILY" != "$DAY" ]; then
    /ops/backup.sh || log "backup.sh failed"
    offbox_sync
    LAST_DAILY="$DAY"
  fi

  if [ "$DOW" = "7" ] && [ "$HOUR" = "23" ] && [ "$LAST_WEEKLY" != "$DAY" ]; then
    /ops/weekly-snapshot.sh || log "weekly-snapshot.sh failed"
    /ops/verify-restore.sh  || log "verify-restore.sh failed"
    offbox_sync
    LAST_WEEKLY="$DAY"
  fi

  sleep 600 # re-check every 10 minutes
done
