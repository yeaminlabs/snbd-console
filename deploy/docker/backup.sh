#!/bin/sh
# Dumps the panel database from the db container into ./backups (next to this script), keeps the newest 14.
# Run it from cron or by hand. Restore: gunzip -c backups/<file>.sql.gz | docker exec -i snbd-console-db psql -U snbd -d snbd_console
set -eu
cd "$(dirname "$0")"
umask 077
mkdir -p backups
OUT="backups/snbd-$(date -u +%Y%m%d-%H%M%S).sql.gz"
docker exec snbd-console-db pg_dump -U snbd -d snbd_console --no-owner | gzip > "$OUT.partial"
gzip -t "$OUT.partial"
mv "$OUT.partial" "$OUT"
ls -1t backups/snbd-*.sql.gz | tail -n +15 | while read -r old; do rm -f -- "$old"; done
echo "backup written: $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
