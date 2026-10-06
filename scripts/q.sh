#!/usr/bin/env bash
# Query helper for dokan-v3 live DB (transaction pooler URL from .env.local).
# Usage: bash scripts/q.sh "select 1"  |  bash scripts/q.sh -f file.sql
set -euo pipefail
cd "$(dirname "$0")/.."
DBURL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"' | tr -d "'")
export PGCONNECT_TIMEOUT=20
exec /usr/sbin/psql "$DBURL" -v ON_ERROR_STOP=1 "$@"
