#!/bin/sh
set -e

export COND_BOARD_POSTGRES_URL="${COND_BOARD_POSTGRES_URL:-postgresql://condo:condo@db:5432/condo_board}"
export DATABASE_URL="$COND_BOARD_POSTGRES_URL"

node scripts/docker-migrate.cjs prepare

output="$(npx drizzle-kit push --force 2>&1)" || exit 1
printf '%s\n' "$output"
if printf '%s\n' "$output" | grep -q '^Error:'; then
  echo "[migrate] drizzle-kit push failed."
  exit 1
fi

node scripts/docker-migrate.cjs verify
