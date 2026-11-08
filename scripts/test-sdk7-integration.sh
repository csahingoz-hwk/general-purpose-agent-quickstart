#!/usr/bin/env bash
set -euo pipefail

# Requires a disposable postgres:17 database exposed on 127.0.0.1:55432.
# Deliberately override service configuration only in this test subprocess.
export POSTGRES_URL='postgres://postgres:synthetic-local-test-password@127.0.0.1:55432/sdk7_tests'
export POSTGRES_URL_NON_POOLING="$POSTGRES_URL"
export GROQ_API_KEY=synthetic-sdk7-provider-key
export APP_OWNER_EMAIL=owner@example.test
export AUTH_SECRET=synthetic-readiness-ui-secret-with-at-least-32-characters
export SDK7_CALL_LOG=/tmp/sdk7-provider-calls.jsonl
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS="--import tsx --import $(pwd)/tests/sdk7/provider-fixture.ts"
export PORT=3101

pnpm exec tsx lib/db/migrate.ts
node --input-type=module <<'JS'
import postgres from 'postgres';
const sql = postgres(process.env.POSTGRES_URL);
try {
  await sql`INSERT INTO "User" (id,email,password) VALUES ('97a9a7c5-e220-425d-9589-7e63b607ca75','owner@example.test',null) ON CONFLICT (id) DO NOTHING`;
} finally { await sql.end(); }
JS
: > "$SDK7_CALL_LOG"
pnpm build
if curl --silent --fail http://localhost:3101/login > /dev/null; then
  echo "Port 3101 is already in use; stop the prior test server first." >&2
  exit 1
fi
node node_modules/next/dist/bin/next start > /tmp/sdk7-integration-server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 30); do
  if curl --silent --fail http://localhost:3101/login > /dev/null; then
    break
  fi
  sleep 1
done
kill -0 "$server_pid"
curl --silent --fail http://localhost:3101/login > /dev/null
node --import tsx scripts/test-sdk7-mobile.ts
