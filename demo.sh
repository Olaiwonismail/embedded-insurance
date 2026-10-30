#!/usr/bin/env bash
# Runs the demo end to end on this machine.
#
#   ./demo.sh          same as start
#   ./demo.sh start    build and start docker, migrate, reset the demo data, run the shop
#   ./demo.sh reset    wipe the demo data and the shop's orders, then seed again
#   ./demo.sh test     every test suite: server, widget, web and end-to-end
#   ./demo.sh stop     stop docker and the test database and redis
#
# Needs docker, node and npm. Reads the database login from server/.env.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

ENV_FILE="server/.env"
SHOP_URL="http://127.0.0.1:4174"
API_HEALTH="http://localhost:3000/health"
TEST_DB_CONTAINER="insureongo-test-db"
TEST_REDIS_CONTAINER="insureongo-test-redis"
TEST_REDIS_PORT=56379

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# One value from server/.env, without running the file as shell.
env_value() {
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

check_env() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE is missing. See server/docs/deployment.md for what goes in it."
  local key
  for key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB ENCRYPTION_KEY ADMIN_API_KEY DEFAULT_COMMISSION_RATE; do
    [ -n "$(env_value "$key")" ] || die "$key is not set in $ENV_FILE."
  done

  # The api reaches Postgres by its container name. localhost there is the api
  # container itself, so a DATABASE_URL copied from a non-docker setup never connects.
  local wanted
  wanted="postgres://$(env_value POSTGRES_USER):$(env_value POSTGRES_PASSWORD)@db:5432/$(env_value POSTGRES_DB)"
  if [ "$(env_value DATABASE_URL)" != "$wanted" ]; then
    grep -vE '^[[:space:]]*DATABASE_URL[[:space:]]*=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
    printf 'DATABASE_URL=%s\n' "$wanted" >> "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
    echo "Set DATABASE_URL in $ENV_FILE to the docker database (host db)"
  fi
}

# The docker database as seen from this machine. The .env copy names the host "db",
# which only works inside docker, and the demo scripts refuse anything not local.
local_database_url() {
  # Encoded, so a password with @ or / in it still makes a valid URL.
  node -e 'const [u, p, d] = process.argv.slice(1).map(encodeURIComponent);
    process.stdout.write(`postgres://${u}:${p}@localhost:5432/${d}`)' \
    "$(env_value POSTGRES_USER)" "$(env_value POSTGRES_PASSWORD)" "$(env_value POSTGRES_DB)"
}

install_deps() {
  say "Installing dependencies"
  local dir
  for dir in . server web widget demo-store; do
    if [ ! -d "$dir/node_modules" ]; then
      npm ci --prefix "$dir"
    fi
  done
}

wait_for_api() {
  say "Waiting for the API"
  local i
  for i in $(seq 1 60); do
    if curl -fsS "$API_HEALTH" >/dev/null 2>&1; then
      echo "API is up."
      return
    fi
    sleep 2
  done
  die "The API did not answer $API_HEALTH within 2 minutes. Check: docker compose logs api"
}

migrate() {
  say "Applying migrations"
  DATABASE_URL="$(local_database_url)" npm run --silent db:migrate --prefix server
}

reset_data() {
  say "Resetting demo data"
  DATABASE_URL="$(local_database_url)" npm run --silent demo:reset --prefix server

  # The shop keeps its orders in a file. If it is running, ask it to clear them so its
  # memory and the file agree; otherwise remove the file.
  if curl -fsS -o /dev/null -X POST "$SHOP_URL/reset" 2>/dev/null; then
    echo "Cleared the shop's orders."
  else
    rm -f demo-store/data/state.json
    echo "Cleared the shop's saved state."
  fi
}

cmd_start() {
  check_env
  install_deps

  say "Building and starting docker (api, web, postgres, redis)"
  # Recreated every time, so a changed server/.env is always picked up.
  docker compose up --build --force-recreate -d

  wait_for_api
  migrate
  reset_data

  say "Ready"
  cat <<EOF
  Merchant pages   http://localhost:8080
  Admin            http://localhost:8080/admin
  Shop             $SHOP_URL

  At signup use domain 127.0.0.1 and tick phones, laptops and tablets.
  Leave the webhook secret blank so one is generated.

  Starting the shop now. Ctrl+C stops it; docker keeps running (./demo.sh stop).
EOF
  npm run dev --prefix demo-store
}

cmd_reset() {
  check_env
  reset_data
}

# The server tests use their own database on 55432, never the demo one.
start_test_db() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$TEST_DB_CONTAINER"; then
    docker rm -f "$TEST_DB_CONTAINER" >/dev/null 2>&1 || true
    docker run -d --name "$TEST_DB_CONTAINER" \
      -e POSTGRES_PASSWORD=test -e POSTGRES_DB=insurance_test \
      -p 55432:5432 postgres:16 >/dev/null
  fi
  local i
  for i in $(seq 1 30); do
    if docker exec "$TEST_DB_CONTAINER" pg_isready -U postgres -d insurance_test >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  die "The test database did not start."
}

# Its own Redis too, on a port nothing else is likely to hold.
start_test_redis() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$TEST_REDIS_CONTAINER"; then
    docker rm -f "$TEST_REDIS_CONTAINER" >/dev/null 2>&1 || true
    docker run -d --name "$TEST_REDIS_CONTAINER" -p "$TEST_REDIS_PORT:6379" redis:7 >/dev/null
  fi
}

cmd_test() {
  install_deps

  say "Starting the test database (55432) and redis ($TEST_REDIS_PORT)"
  start_test_db
  start_test_redis
  export REDIS_URL="redis://127.0.0.1:$TEST_REDIS_PORT"

  say "Server tests"
  npm test --prefix server
  say "Widget tests"
  npm test --prefix widget
  say "Web tests"
  npm test --prefix web
  say "End-to-end test"
  npm run test:e2e

  say "All tests passed"
}

cmd_stop() {
  say "Stopping"
  docker compose down
  docker rm -f "$TEST_DB_CONTAINER" "$TEST_REDIS_CONTAINER" >/dev/null 2>&1 || true
}

case "${1:-start}" in
  start) cmd_start ;;
  reset) cmd_reset ;;
  test) cmd_test ;;
  stop) cmd_stop ;;
  *) die "Usage: ./demo.sh [start|reset|test|stop]" ;;
esac
