#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL in .env}"
STAMP=$(date +%Y%m%d_%H%M%S)
pg_dump --no-owner --format=custom "$DATABASE_URL" -f "backup_${STAMP}.dump"
echo "Backup: backup_${STAMP}.dump"