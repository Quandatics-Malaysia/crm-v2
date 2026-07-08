#!/bin/sh
# Daily backup — mirrors the client's Salesforce "Full Data" export pattern
# (System Admin/Power Automate). Writes a per-object CSV export + a full pg_dump
# + an appfiles archive into /backups/full-data (overwritten each day; the
# weekly snapshot archives dated copies). Runs as the DB admin role so it sees
# every tenant's rows (RLS is bypassed for superuser).
set -eu
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL must be set}"

FULL=/backups/full-data
OBJ="$FULL/objects"
APP_SRC=/data/uploads
mkdir -p "$OBJ"

log() { echo "[backup $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
log "starting daily backup ($STAMP)"

# 1. Per-object CSV export of every public base table (their "Full Data" folder).
TABLES=$(psql "$DATABASE_ADMIN_URL" -At -c \
  "select tablename from pg_tables where schemaname='public' and tablename <> '__drizzle_migrations' order by tablename")
count=0
for t in $TABLES; do
  psql "$DATABASE_ADMIN_URL" -At -c \
    "\copy (select * from public.\"$t\") to '$OBJ/$t.csv' with (format csv, header true)" >/dev/null
  count=$((count + 1))
done
log "exported $count objects → $OBJ/*.csv"

# 2. Full DB dump — the guaranteed restore path (CSV alone won't round-trip
#    FKs/types/RLS). Custom format so pg_restore can do a clean restore.
pg_dump -Fc "$DATABASE_ADMIN_URL" -f "$FULL/crm.dump"
log "pg_dump → crm.dump ($(du -h "$FULL/crm.dump" | cut -f1))"

# 3. Uploaded documents (the appfiles volume).
if [ -d "$APP_SRC" ]; then
  tar -czf "$FULL/appfiles.tar.gz" -C "$APP_SRC" . 2>/dev/null || true
  log "appfiles → appfiles.tar.gz ($(du -h "$FULL/appfiles.tar.gz" 2>/dev/null | cut -f1))"
fi

echo "$STAMP" > "$FULL/LAST_BACKUP"
log "daily backup complete"
