#!/bin/sh
set -e

export COND_BOARD_POSTGRES_URL="${COND_BOARD_POSTGRES_URL:-postgresql://condo:condo@db:5432/condo_board}"
export DATABASE_URL="$COND_BOARD_POSTGRES_URL"

echo "[startup] Ensuring database schema..."
node scripts/docker-migrate.cjs run

exec node server.js
