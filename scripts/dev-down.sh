#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ -f .env ]]; then
  set -a
  source ./.env
  set +a
fi

SERVER_PORT="${SERVER_PORT:-8080}"
stopped_api="0"

if [[ -f .run/api.pid ]]; then
  API_PID="$(cat .run/api.pid || true)"
  if [[ -n "${API_PID}" ]] && kill -0 "${API_PID}" >/dev/null 2>&1; then
    kill "${API_PID}" || true
    echo "Stopped API (PID ${API_PID})."
    stopped_api="1"
  fi
  rm -f .run/api.pid
fi

if [[ "${stopped_api}" != "1" ]]; then
  PORT_PIDS="$(lsof -tiTCP:${SERVER_PORT} -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${PORT_PIDS}" ]]; then
    while IFS= read -r pid; do
      [[ -z "${pid}" ]] && continue
      if kill -0 "${pid}" >/dev/null 2>&1; then
        kill "${pid}" || true
        echo "Stopped API listener on port ${SERVER_PORT} (PID ${pid})."
      fi
    done <<< "${PORT_PIDS}"
  fi
fi

./scripts/db-down.sh
echo "Stopped PostgreSQL."
