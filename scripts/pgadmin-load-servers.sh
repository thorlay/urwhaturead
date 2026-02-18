#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v docker >/dev/null 2>&1 && [[ -x "/Applications/Docker.app/Contents/Resources/bin/docker" ]]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:${PATH}"
fi

if [[ -f .env ]]; then
  set -a
  source ./.env
  set +a
fi

PGADMIN_DEFAULT_EMAIL="${PGADMIN_DEFAULT_EMAIL:-admin@example.com}"

for _ in {1..30}; do
  if docker compose exec -T pgadmin true >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker compose exec -T pgadmin \
  /venv/bin/python /pgadmin4/setup.py load-servers /pgadmin4/servers.json \
  --user "${PGADMIN_DEFAULT_EMAIL}" \
  --replace >/dev/null

echo "pgAdmin servers loaded for ${PGADMIN_DEFAULT_EMAIL}."
