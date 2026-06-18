#!/bin/sh
set -e

# Coolify may inject a host-local DATABASE_URL copied from .env.local. Inside the
# compose stack, Postgres is always the `db` service on port 5432.
if [ -n "$COMPOSE_DATABASE_URL" ]; then
  export DATABASE_URL="$COMPOSE_DATABASE_URL"
fi

exec node server.js
