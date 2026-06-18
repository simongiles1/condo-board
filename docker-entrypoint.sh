#!/bin/sh
set -e

# Coolify often injects a host-local DATABASE_URL from .env.local. Always use the
# compose stack Postgres service (`db:5432`) for this container.
export DATABASE_URL="${COMPOSE_DATABASE_URL:-postgresql://condo:condo@db:5432/condo_board}"

exec node server.js
