#!/bin/sh
set -e

export DATABASE_URL="${COMPOSE_DATABASE_URL:-postgresql://condo:condo@db:5432/condo_board}"

node scripts/docker-migrate.cjs prepare
npx drizzle-kit push
node scripts/docker-migrate.cjs verify
