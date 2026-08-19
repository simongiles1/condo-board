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

echo "[startup] Running database migrations..."
node scripts/db-migrate.cjs

echo "[startup] Starting Next.js..."
# Prefer IPv4 so a dead IPv6 route to the Supabase pooler does not stall ~30s.
existing_node_options="${NODE_OPTIONS:-}"
case "$existing_node_options" in
  *dns-result-order*) ;;
  *) export NODE_OPTIONS="${existing_node_options} --dns-result-order=ipv4first" ;;
esac
exec node server.js
