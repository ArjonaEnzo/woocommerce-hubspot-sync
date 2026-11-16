#!/usr/bin/env bash
# Starts F1 (backfill) in the running n8n. Optional: first argument = chunk to start from (resume).
# Follow progress in the n8n editor → Executions.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
curl -sf -X POST "http://localhost:5679/webhook/woo-backfill" \
  -H "x-backfill-token: $WOO_WEBHOOK_SECRET" -H "content-type: application/json" \
  -d "{\"startChunk\": ${1:-0}}" && echo
