#!/usr/bin/env bash
# Builds workflows/dist and imports every workflow into the local n8n (same ids → re-import overwrites).
# n8n 2.x only runs published sub-workflows and webhooks, so those get published; the backfill stays manual.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
node scripts/build-workflows.mjs
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows
for id in wfHubspotReq0001 wfSyncOrders0001 wfErrorHandler01 wfRealtime000001; do
  if [ -f "workflows/dist/$(grep -l "\"id\": \"$id\"" workflows/dist/*.json | xargs -n1 basename 2>/dev/null | head -1)" ]; then
    docker compose exec -T n8n n8n publish:workflow --id="$id" | tail -1
  fi
done
# The running instance picks up CLI publish changes on restart.
docker compose restart n8n >/dev/null && echo "n8n restarted."
