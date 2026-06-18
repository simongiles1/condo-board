#!/bin/sh

export COND_BOARD_POSTGRES_URL="${COND_BOARD_POSTGRES_URL:-postgresql://condo:condo@db:5432/condo_board}"
export DATABASE_URL="$COND_BOARD_POSTGRES_URL"

echo "[startup] Database URL host: $(node -e "try { console.log(new URL(process.env.COND_BOARD_POSTGRES_URL).host) } catch { console.log('invalid') }")"

echo "[startup] Waiting for Postgres..."
ready=0
i=0
while [ "$i" -lt 15 ]; do
  if node scripts/wait-for-postgres.cjs; then
    ready=1
    break
  fi
  i=$((i + 1))
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  echo "[startup] WARN: Postgres not reachable after 30s; starting app anyway."
else
  echo "[startup] Postgres is reachable."
fi

echo "[startup] Running database setup (best effort, non-blocking)..."
node scripts/docker-migrate.cjs run

echo "[startup] Starting Next.js..."
exec node server.js
