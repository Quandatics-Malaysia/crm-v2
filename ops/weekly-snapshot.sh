#!/bin/sh
# Weekly dated snapshot — mirrors the client's "Copy Full Data File to Backup
# Folder" (System Admin/Power Automate): copy the daily Full Data folder into a
# dated archive folder, then prune archives older than 8 weeks.
set -eu
FULL=/backups/full-data
ARCHIVE=/backups/archive
DATE=$(date -u +%Y-%m-%d)
DEST="$ARCHIVE/$DATE"

log() { echo "[snapshot $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }

if [ ! -d "$FULL" ]; then
  log "no full-data folder yet — run backup.sh first"; exit 1
fi

mkdir -p "$DEST"
cp -a "$FULL/." "$DEST/"
log "full-data → $DEST ($(du -sh "$DEST" | cut -f1))"

# Retain 8 weeks of dated snapshots.
find "$ARCHIVE" -maxdepth 1 -type d -name '20*' -mtime +56 -exec rm -rf {} + 2>/dev/null || true
log "pruned dated archives older than 56 days"
