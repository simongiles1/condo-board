#!/bin/sh
set -e

# Coolify injects DATABASE_URL automatically (often a host-local value). This app
# always uses the compose Postgres service via COND_BOARD_POSTGRES_URL instead.
export COND_BOARD_POSTGRES_URL="${COND_BOARD_POSTGRES_URL:-postgresql://condo:condo@db:5432/condo_board}"
export DATABASE_URL="$COND_BOARD_POSTGRES_URL"

exec node server.js
