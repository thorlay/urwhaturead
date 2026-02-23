#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

mkdir -p .run
LOCK_FILE=".run/auto-update.lock"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[auto-update] another run is in progress, skip"
  exit 0
fi

BRANCH="${AUTO_UPDATE_BRANCH:-main}"
MIN_COMMITS="${AUTO_UPDATE_MIN_COMMITS:-1}"
API_SERVICE_NAME="${API_SERVICE_NAME:-quick-api}"

if ! [[ "${MIN_COMMITS}" =~ ^[0-9]+$ ]]; then
  echo "[auto-update] AUTO_UPDATE_MIN_COMMITS must be a non-negative integer"
  exit 1
fi

if [[ ! -d .git ]]; then
  echo "[auto-update] not a git repository: ${ROOT_DIR}"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "[auto-update] git command not found"
  exit 1
fi

run_systemctl() {
  if [[ "${EUID}" -eq 0 ]]; then
    systemctl "$@"
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    sudo -n systemctl "$@"
    return $?
  fi
  return 1
}

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[auto-update] working tree has local changes, skip to avoid override"
  exit 0
fi

echo "[auto-update] checking origin/${BRANCH} ..."
git fetch --quiet origin "${BRANCH}"

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "origin/${BRANCH}")"
BEHIND_COUNT="$(git rev-list --count "${LOCAL_SHA}..${REMOTE_SHA}")"

if (( BEHIND_COUNT < MIN_COMMITS )); then
  echo "[auto-update] no deploy needed (behind=${BEHIND_COUNT}, threshold=${MIN_COMMITS})"
  exit 0
fi

echo "[auto-update] updating repository (behind=${BEHIND_COUNT})"
git pull --ff-only origin "${BRANCH}"

if [[ -f .env ]]; then
  set -a
  source ./.env
  set +a
fi

mkdir -p bin
echo "[auto-update] building backend ..."
go build -o ./bin/quick-server ./cmd/server

if systemctl list-unit-files "${API_SERVICE_NAME}.service" >/dev/null 2>&1; then
  echo "[auto-update] restarting ${API_SERVICE_NAME}.service ..."
  if ! run_systemctl restart "${API_SERVICE_NAME}.service"; then
    echo "[auto-update] warning: restart ${API_SERVICE_NAME}.service failed (permission?)"
  fi
else
  echo "[auto-update] warning: ${API_SERVICE_NAME}.service not found, skip restart"
fi

if [[ -d frontend ]]; then
  if command -v npm >/dev/null 2>&1; then
    echo "[auto-update] building frontend ..."
    (
      cd frontend
      npm ci
      npm run build
    )
  else
    echo "[auto-update] warning: npm not found, skip frontend build"
  fi
fi

if systemctl list-unit-files caddy.service >/dev/null 2>&1; then
  echo "[auto-update] reloading caddy ..."
  if ! run_systemctl reload caddy; then
    echo "[auto-update] warning: reload caddy failed (permission?)"
  fi
fi

echo "[auto-update] done"
