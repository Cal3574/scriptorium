#!/usr/bin/env bash
# Local dev entrypoint: bring up infra, migrate, seed, then serve all apps.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found - copying .env.example. Fill in real secrets before use."
  cp .env.example .env
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

echo "==> docker compose up (waiting for healthchecks)"
docker compose up --wait

echo "==> database:migrate"
pnpm nx run database:migrate

echo "==> database:seed"
pnpm nx run database:seed

echo "==> serving client, api, worker"
exec pnpm nx run-many -t serve -p client api worker
