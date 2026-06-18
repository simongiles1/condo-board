#!/bin/sh
set -e

export COND_BOARD_POSTGRES_URL="${COND_BOARD_POSTGRES_URL:-postgresql://condo:condo@db:5432/condo_board}"
export DATABASE_URL="$COND_BOARD_POSTGRES_URL"

node scripts/docker-migrate.cjs prepare

set +e
output="$(npx drizzle-kit push --force 2>&1)"
push_status=$?
set -e

printf '%s\n' "$output"
if [ "$push_status" -ne 0 ]; then
  echo "[migrate] drizzle-kit push exited with status ${push_status}; continuing to verify."
fi

node scripts/docker-migrate.cjs verify
