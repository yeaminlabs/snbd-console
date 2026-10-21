#!/bin/sh
# Dumps the panel database to $BACKUP_DIR (default ./backups), checks the dump is readable, keeps the newest $KEEP (default 14).
# Needs DATABASE_URL. The dump holds password hashes and key hashes: store it like a secret and copy it off this machine.
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}"
KEEP="${KEEP:-14}"
umask 077
mkdir -p "$DIR"
OUT="$DIR/snbd-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$OUT.partial"
pg_restore --list "$OUT.partial" >/dev/null   # fails if the file is truncated or corrupt
mv "$OUT.partial" "$OUT"
# retention: delete all but the newest $KEEP complete dumps
ls -1t "$DIR"/snbd-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f -- "$old"; done
echo "backup written: $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
