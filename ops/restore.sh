#!/bin/sh
# Restore the CRM from a pg_dump produced by backup.sh. DESTRUCTIVE — clean
# restore over the live database. Refuses to run without an explicit --yes.
#   Usage: restore.sh [dump-path] --yes
#   Default dump: /backups/full-data/crm.dump
set -eu
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL must be set}"

DUMP="/backups/full-data/crm.dump"
CONFIRM=""
for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRM=yes ;;
    *) DUMP="$arg" ;;
  esac
done

log() { echo "[restore $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }

if [ "$CONFIRM" != "yes" ]; then
  echo "Refusing to restore without confirmation."
  echo "This CLEAN-restores $DUMP over the live database (data loss)."
  echo "Re-run with:  restore.sh $DUMP --yes"
  exit 2
fi
[ -f "$DUMP" ] || { echo "dump not found: $DUMP"; exit 1; }

log "clean-restoring $DUMP → crm (stop the web app first!)"
# --clean --if-exists drops+recreates objects; RLS policies and grants travel in
# the dump, and the crm_app role is cluster-level so it survives.
pg_restore --clean --if-exists -d "$DATABASE_ADMIN_URL" "$DUMP"
log "database restored"

# Uploaded documents.
if [ -f /backups/full-data/appfiles.tar.gz ] && [ -d /data/uploads ]; then
  tar -xzf /backups/full-data/appfiles.tar.gz -C /data/uploads
  log "appfiles restored"
fi
log "restore complete — re-run 'docker compose run --rm migrate' if the crm_app password needs re-syncing"
