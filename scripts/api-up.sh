#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then
  set -a
  source ./.env
  set +a
fi

mkdir -p .gocache
export GOCACHE="${PWD}/.gocache"

go run ./cmd/server
