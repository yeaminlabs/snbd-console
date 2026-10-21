#!/bin/sh
# Restores a dump into an EMPTY database:  createdb snbd_restore && DATABASE_URL=postgres:///snbd_restore ./scripts/restore-db.sh backups/snbd-....dump
# Refuses to touch a database that already has tables, so it cannot overwrite live data by accident.
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
FILE="${1:?usage: restore-db.sh <dump file>}"
[ -r "$FILE" ] || { echo "cannot read $FILE" >&2; exit 1; }
n=$(psql "$DATABASE_URL" -tAc "select count(*) from information_schema.tables where table_schema = 'public'")
[ "$n" = 0 ] || { echo "refusing: the target database already has $n tables" >&2; exit 1; }
pg_restore --no-owner --exit-on-error --dbname="$DATABASE_URL" "$FILE"
echo "restored $FILE"
