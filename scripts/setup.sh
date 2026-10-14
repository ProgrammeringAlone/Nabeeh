#!/usr/bin/env bash
set -euo pipefail
cd /workspace/Nabeeh
npm ci --cache /workspace/.npm-cache
setup_db_pid=''
cleanup() {
  if [ -n "$setup_db_pid" ]; then
    kill -TERM "$setup_db_pid" 2>/dev/null || true
    wait "$setup_db_pid" || true
  fi
}
trap cleanup EXIT
db_check() {
  node --import tsx --input-type=module -e 'import {pool} from "./server/db.ts"; try {await pool.query("SELECT 1");await pool.end();} catch {await pool.end();process.exit(1);}' >/dev/null 2>&1
}
if ! db_check; then
  if [ -n "${DATABASE_URL:-}" ]; then
    echo 'Configured DATABASE_URL is not reachable; check its binding before setup.' >&2
    exit 1
  fi
  mkdir -p .local
  node --import tsx scripts/local-db.ts > .local/setup-postgres.log 2>&1 &
  setup_db_pid=$!
  for attempt in $(seq 1 30); do
    if db_check; then break; fi
    if ! kill -0 "$setup_db_pid" 2>/dev/null; then cat .local/setup-postgres.log; exit 1; fi
    sleep 1
  done
  db_check
fi
npm run db:migrate
if [ "${NODE_ENV:-development}" != 'production' ]; then npm run db:seed; fi
npm run db:index-facts
npm run release:prepare
npm run build
echo 'Dependencies, schema and build prepared. Start runtime processes using environment startup instructions.'
