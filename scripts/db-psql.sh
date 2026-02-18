#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1 && [[ -x "/Applications/Docker.app/Contents/Resources/bin/docker" ]]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:${PATH}"
fi

if [[ ! -f .env ]]; then
  echo ".env not found. Run ./scripts/db-up.sh first."
  exit 1
fi

set -a
source ./.env
set +a

docker compose exec postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"
