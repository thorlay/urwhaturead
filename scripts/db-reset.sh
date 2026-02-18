#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1 && [[ -x "/Applications/Docker.app/Contents/Resources/bin/docker" ]]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:${PATH}"
fi

docker compose down -v
rm -rf ./data/postgres
docker compose up -d postgres
echo "Database reset complete."
