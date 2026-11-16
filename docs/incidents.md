# Incident log (raw material for the README "What went wrong")

Dated notes written while building. Each: what happened → cause → fix.

- 2026-11-15 — WooCommerce REST basic auth is refused over plain HTTP (Woo only accepts consumer key/secret basic auth on HTTPS, otherwise expects OAuth 1.0a). → Used a WordPress Application Password instead; WordPress allows those over HTTP only when `WP_ENVIRONMENT_TYPE=local`.
- 2026-11-15 — Woo webhooks to `http://n8n:5678` are blocked: delivery uses `wp_safe_remote_request()`, which rejects private hosts. → mu-plugin whitelists the `n8n` hostname only.
- 2026-11-15 — Current WooCommerce requires WordPress 7.0; the first stack pinned wordpress:6.8 and `wp plugin install woocommerce` refused. → Pinned wordpress:7.0.
- 2026-11-15 — n8n 2.x refused to run the HubSpot sub-workflow: "Workflow is not active and cannot be executed." Sub-workflows must be published now. → Import script publishes the sub-workflows (`n8n publish:workflow`).
- 2026-11-15 — POST requests reached HubSpot with an empty body. The HTTP node's "Send Body" was an expression, and n8n drops the parameters that depend on it (JSON body) when it is not a literal `true`. → Two HTTP nodes (with/without body) behind an IF.
- 2026-11-15 — Port 5678 already taken by another local n8n; the demo's n8n is published on 5679.
- 2026-11-15 — Woo would not deliver webhooks to `http://n8n:5678` even after allowing the host: `wp_safe_remote_request()` also limits ports to 80/443/8080. → mu-plugin adds 5678 via `http_allowed_safe_ports`.
- 2026-11-15 — The first error tickets only said "Error executing workflow with item at index 0" (the parent's wrapper message). The HubSpot status was in the error's `description`. → The error workflow now writes both, plus a working link to the failed execution.
- 2026-11-15 — n8n CLI commands (`n8n execute`, `import:workflow`, `publish:workflow`) looked hung: one backfill stopped after the line-items step for minutes, a publish sat at 100% CPU. Profiling with `N8N_LOG_LEVEL=debug` showed the real cost: every CLI command boots a full n8n (~1-2 min on this machine, 55 s before the first log line), so import + 5 publishes ≈ 8 min. → Backfill now has a token-protected webhook trigger (runs inside the already-running instance, like production); import/publish run once, in a one-off container while the service is stopped, and the script just waits.
