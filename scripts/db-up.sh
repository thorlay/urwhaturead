#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1 && [[ -x "/Applications/Docker.app/Contents/Resources/bin/docker" ]]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:${PATH}"
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

docker compose up -d postgres pgadmin
echo "PostgreSQL + pgAdmin are starting. Check status with: docker compose ps"

if ./scripts/pgadmin-load-servers.sh >/dev/null 2>&1; then
  echo "pgAdmin server preset applied."
else
  echo "pgAdmin server preset skipped (pgAdmin may still be starting)."
fi
