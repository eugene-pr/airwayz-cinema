#!/usr/bin/env bash
# Dev helpers. Usage: ./dev.sh <cmd>
set -euo pipefail
cd "$(dirname "$0")"

psql_db() { docker compose exec -T db psql -U cinema -d cinema "$@"; }

wait_api() {
  printf "waiting for api"
  for _ in $(seq 1 60); do
    curl -fs http://localhost:3000/api/health >/dev/null && { echo " ok"; return; }
    printf "."; sleep 1
  done
  echo " timeout"; docker compose logs --tail 50 api; exit 1
}

case "${1:-}" in
  fresh)
    docker compose down -v --remove-orphans
    docker compose up --build -d
    wait_api # api runs migrations on boot
    npm run seed
    echo
    echo "web:   http://localhost:5173"
    echo "login: alice|bob|carol|dave|erin @example.com / password"
    ;;
  reset-db)
    psql_db -c "TRUNCATE seat_claims, holds;"
    echo "reservations cleared (users + seats kept)"
    ;;
  logs)
    shift; docker compose logs -f "$@"
    ;;
  *)
    cat <<EOF
usage: ./dev.sh <cmd>
  fresh       wipe db volume, rebuild, start, migrate, seed
  reset-db    clear all reservations, keep users + seats
  logs [svc]  follow compose logs (api|web|db)
EOF
    ;;
esac
