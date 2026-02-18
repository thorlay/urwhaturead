#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v docker >/dev/null 2>&1 && [[ -x "/Applications/Docker.app/Contents/Resources/bin/docker" ]]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:${PATH}"
fi

DETACH="${1:-}"

./scripts/db-up.sh

if [[ -f .env ]]; then
  set -a
  source ./.env
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-quick}"
POSTGRES_DB="${POSTGRES_DB:-news_dev}"

echo "Waiting for PostgreSQL to be ready..."
for _ in {1..40}; do
  if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
    echo "PostgreSQL is ready."
    break
  fi
  sleep 1
done

if ! docker compose exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
  echo "PostgreSQL did not become ready in time."
  exit 1
fi

if [[ "${DETACH}" == "--detach" ]]; then
  mkdir -p .run

  if [[ -f .run/api.pid ]]; then
    OLD_PID="$(cat .run/api.pid || true)"
    if [[ -n "${OLD_PID}" ]] && kill -0 "${OLD_PID}" >/dev/null 2>&1; then
      echo "API already running with PID ${OLD_PID}."
      echo "Log file: ${ROOT_DIR}/.run/api.log"
      exit 0
    fi
  fi

  nohup ./scripts/api-up.sh > .run/api.log 2>&1 &
  API_PID="$!"
  echo "${API_PID}" > .run/api.pid
  sleep 1

  if ! kill -0 "${API_PID}" >/dev/null 2>&1; then
    echo "API failed to start in background."
    echo "Recent log:"
    tail -n 60 .run/api.log || true
    rm -f .run/api.pid
    exit 1
  fi

  echo "API started in background (PID ${API_PID})."
  echo "Log file: ${ROOT_DIR}/.run/api.log"
  exit 0
fi

echo "Starting API in foreground..."
exec ./scripts/api-up.sh
