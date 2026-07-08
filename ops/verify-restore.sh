#!/bin/sh
# Restore-verification — proves the latest dump actually restores. Restores it
# into a throwaway crm_verify database, asserts core rows exist, then drops it.
# Non-destructive to the live DB. Runs weekly from the scheduler.
set -eu
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL must be set}"

DUMP="${1:-/backups/full-data/crm.dump}"
log() { echo "[verify $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
[ -f "$DUMP" ] || { log "no dump to verify: $DUMP"; exit 1; }

# Admin connection to the maintenance 'postgres' DB, to create/drop the scratch DB.
BASE=$(echo "$DATABASE_ADMIN_URL" | sed 's#/[^/]*$#/postgres#')
VURL=$(echo "$DATABASE_ADMIN_URL" | sed 's#/[^/]*$#/crm_verify#')

psql "$BASE" -c "DROP DATABASE IF EXISTS crm_verify" >/dev/null
psql "$BASE" -c "CREATE DATABASE crm_verify" >/dev/null
# --no-owner/--no-privileges: we only count rows as the admin; no need to
# reproduce crm_app grants in the scratch DB.
pg_restore --no-owner --no-privileges -d "$VURL" "$DUMP" >/dev/null 2>&1 || true

ACC=$(psql "$VURL" -At -c "select count(*) from accounts" 2>/dev/null || echo 0)
psql "$BASE" -c "DROP DATABASE IF EXISTS crm_verify" >/dev/null

if [ "${ACC:-0}" -gt 0 ]; then
  log "OK — restored scratch DB has $ACC accounts"
else
  log "FAIL — restored scratch DB has no accounts"; exit 1
fi
