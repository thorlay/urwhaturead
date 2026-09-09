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
DEPLOYED_SHA_FILE=".run/deployed-sha"

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

if ! git merge-base --is-ancestor "${LOCAL_SHA}" "${REMOTE_SHA}"; then
  echo "[auto-update] local branch has diverged from origin/${BRANCH}; manual intervention required" >&2
  exit 1
fi

if [[ -s "${DEPLOYED_SHA_FILE}" ]] && git cat-file -e "$(cat "${DEPLOYED_SHA_FILE}")^{commit}" 2>/dev/null; then
  DEPLOYED_SHA="$(cat "${DEPLOYED_SHA_FILE}")"
  if git merge-base --is-ancestor "${DEPLOYED_SHA}" "${REMOTE_SHA}"; then
    PENDING_COUNT="$(git rev-list --count "${DEPLOYED_SHA}..${REMOTE_SHA}")"
  else
    PENDING_COUNT="${MIN_COMMITS}"
  fi
else
  # Force one verified deployment when upgrading from the legacy script.
  DEPLOYED_SHA=""
  PENDING_COUNT="${MIN_COMMITS}"
fi

if (( PENDING_COUNT < MIN_COMMITS )); then
  echo "[auto-update] no deploy needed (pending=${PENDING_COUNT}, threshold=${MIN_COMMITS})"
  exit 0
fi

if [[ "${LOCAL_SHA}" != "${REMOTE_SHA}" ]]; then
  echo "[auto-update] updating repository (pending=${PENDING_COUNT})"
  git pull --ff-only origin "${BRANCH}"
else
  echo "[auto-update] retrying undeployed commit ${REMOTE_SHA:0:12}"
fi

if [[ -f .env ]]; then
  set -a
  source ./.env
  set +a
fi

GO_BIN="${GO_BIN:-$(command -v go || true)}"
if [[ -z "${GO_BIN}" && -x /snap/bin/go ]]; then
  GO_BIN=/snap/bin/go
fi
if [[ -z "${GO_BIN}" ]]; then
  echo "[auto-update] go is required" >&2
  exit 1
fi
if [[ -d frontend ]] && ! command -v npm >/dev/null 2>&1; then
  echo "[auto-update] npm is required" >&2
  exit 1
fi

BUILD_DIR="$(mktemp -d "${ROOT_DIR}/.run/deploy.XXXXXX")"
trap 'rm -rf "${BUILD_DIR}"' EXIT

echo "[auto-update] testing backend ..."
"${GO_BIN}" test ./...
echo "[auto-update] building backend ..."
"${GO_BIN}" build -o "${BUILD_DIR}/quick-server" ./cmd/server

if [[ -d frontend ]]; then
  echo "[auto-update] testing and building frontend ..."
  (
    cd frontend
    npm ci
    npm run lint
    ./node_modules/.bin/tsc -b
    ./node_modules/.bin/vite build --outDir "${BUILD_DIR}/frontend-dist"
  )
fi

echo "[auto-update] activating build ..."
mkdir -p bin
if [[ -f bin/quick-server ]]; then
  cp -p bin/quick-server "${BUILD_DIR}/quick-server-previous"
fi
install -m 0755 "${BUILD_DIR}/quick-server" "${BUILD_DIR}/quick-server-next"
mv -f "${BUILD_DIR}/quick-server-next" bin/quick-server

FRONTEND_ACTIVATED=0
if [[ -d "${BUILD_DIR}/frontend-dist" ]]; then
  if [[ -d frontend/dist ]]; then
    mv frontend/dist "${BUILD_DIR}/frontend-dist-previous"
  fi
  if ! mv "${BUILD_DIR}/frontend-dist" frontend/dist; then
    [[ ! -d "${BUILD_DIR}/frontend-dist-previous" ]] || mv "${BUILD_DIR}/frontend-dist-previous" frontend/dist
    echo "[auto-update] failed to activate frontend build" >&2
    exit 1
  fi
  FRONTEND_ACTIVATED=1
fi

rollback_build() {
  echo "[auto-update] activation failed; restoring previous build" >&2
  if [[ -f "${BUILD_DIR}/quick-server-previous" ]]; then
    mv -f "${BUILD_DIR}/quick-server-previous" bin/quick-server
  fi
  if (( FRONTEND_ACTIVATED == 1 )); then
    rm -rf frontend/dist
    if [[ -d "${BUILD_DIR}/frontend-dist-previous" ]]; then
      mv "${BUILD_DIR}/frontend-dist-previous" frontend/dist
    fi
  fi
}

if systemctl list-unit-files "${API_SERVICE_NAME}.service" >/dev/null 2>&1; then
  echo "[auto-update] restarting ${API_SERVICE_NAME}.service ..."
  if ! run_systemctl restart "${API_SERVICE_NAME}.service"; then
    rollback_build
    run_systemctl restart "${API_SERVICE_NAME}.service" || true
    exit 1
  fi

  READY_URL="${AUTO_UPDATE_READY_URL:-http://127.0.0.1:${PORT:-8080}/readyz}"
  if command -v curl >/dev/null 2>&1; then
    READY=0
    for _ in {1..30}; do
      if curl --fail --silent --max-time 2 "${READY_URL}" >/dev/null; then
        READY=1
        break
      fi
      sleep 1
    done
    if (( READY == 0 )); then
      echo "[auto-update] readiness check failed: ${READY_URL}" >&2
      rollback_build
      run_systemctl restart "${API_SERVICE_NAME}.service" || true
      exit 1
    fi
  fi
else
  echo "[auto-update] warning: ${API_SERVICE_NAME}.service not found, skip restart"
fi

if systemctl list-unit-files caddy.service >/dev/null 2>&1; then
  echo "[auto-update] reloading caddy ..."
  if ! run_systemctl reload caddy; then
    echo "[auto-update] warning: reload caddy failed (permission?)"
  fi
fi

printf '%s\n' "${REMOTE_SHA}" >"${DEPLOYED_SHA_FILE}"
echo "[auto-update] done"
