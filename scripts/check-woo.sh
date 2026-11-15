#!/usr/bin/env bash
# Smoke test: Woo REST reachable with the n8n application password. Prints counts only (no secrets).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
for resource in products orders; do
  total=$(curl -s -o /dev/null -D - -u "$WP_ADMIN_USER:$WOO_APP_PASSWORD" \
    "http://localhost:8080/wp-json/wc/v3/$resource?per_page=1" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-wp-total"{print $2}')
  echo "$resource: ${total:-ERROR}"
done
