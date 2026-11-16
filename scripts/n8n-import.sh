#!/usr/bin/env bash
# Builds workflows/dist and imports every workflow into the local n8n (same ids → re-import overwrites).
# n8n 2.x only runs published sub-workflows and webhooks, so every workflow gets published.
# Import + publish run in a one-off container while the n8n service is stopped: running the CLI next to
# a live instance hung on publish (see docs/incidents.md).
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
node scripts/build-workflows.mjs
docker compose stop n8n >/dev/null
docker compose run --rm --no-deps -T --entrypoint sh n8n -c '
  set -e
  n8n import:workflow --separate --input=/workflows
  for id in wfHubspotReq0001 wfSyncOrders0001 wfErrorHandler01 wfRealtime000001 wfBackfill000001; do
    n8n publish:workflow --id="$id" >/dev/null && echo "published $id"
  done' 2>&1 | grep -E "imported|published|rror"
docker compose up -d n8n >/dev/null
until curl -sf http://localhost:5679/healthz >/dev/null; do sleep 2; done
echo "n8n is up."
