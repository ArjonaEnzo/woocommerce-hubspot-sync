#!/usr/bin/env bash
# Idempotent WordPress + WooCommerce setup for the demo stack.
# Usage: docker compose up -d && bash scripts/setup-woo.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env
set -a; . ./.env; set +a

wp() { MSYS_NO_PATHCONV=1 docker compose run --rm -T wpcli wp "$@"; }

echo "Waiting for the database..."
until wp db check >/dev/null 2>&1; do sleep 3; done

if ! wp core is-installed >/dev/null 2>&1; then
  wp core install --url=http://localhost:8080 --title="Demo Store" \
    --admin_user="$WP_ADMIN_USER" --admin_password="$WP_ADMIN_PASSWORD" \
    --admin_email=admin@demo-store.test --skip-email
fi

wp plugin is-active woocommerce >/dev/null 2>&1 || wp plugin install woocommerce --activate

if [ -z "${WOO_WEBHOOK_SECRET:-}" ]; then
  sed -i "s|^WOO_WEBHOOK_SECRET=.*|WOO_WEBHOOK_SECRET=$(openssl rand -hex 32)|" .env
fi

wp option update woocommerce_currency USD
wp option update woocommerce_default_country "US:CA"
# HPOS: orders live in wc_orders tables (the sync only uses the REST API, so it does not care).
wp option update woocommerce_custom_orders_table_enabled yes
wp option update woocommerce_onboarding_profile '{"skipped":true}' --format=json
wp rewrite structure '/%postname%/'

wp eval-file /cli/seed-products.php

# Application password for n8n (WP_ENVIRONMENT_TYPE=local allows it over HTTP).
if [ -z "${WOO_APP_PASSWORD:-}" ]; then
  pw=$(wp user application-password create "$WP_ADMIN_USER" n8n --porcelain | tr -d '\r')
  sed -i "s|^WOO_APP_PASSWORD=.*|WOO_APP_PASSWORD=$pw|" .env
  echo "Application password written to .env (WOO_APP_PASSWORD)."
fi

echo "Done. Store: http://localhost:8080  ·  n8n: http://localhost:5679"
