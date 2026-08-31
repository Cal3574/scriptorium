#!/usr/bin/env bash
# db lifecycle helper: up | down | reset
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

case "${1:-}" in
  up)
    docker compose up --wait postgres redis
    ;;
  down)
    docker compose down
    ;;
  reset)
    docker compose down -v
    docker compose up --wait postgres redis
    pnpm nx run database:migrate
    pnpm nx run database:seed
    ;;
  *)
    echo "usage: $0 {up|down|reset}" >&2
    exit 1
    ;;
esac
