# WooCommerce → HubSpot Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public demo repo that syncs a local WooCommerce store into a HubSpot developer test account through n8n — idempotent, refund-aware, with data-quality quarantine, retries, two HubSpot workflows and a 6-report dashboard.

**Architecture:** `docker compose up` runs WordPress+WooCommerce, MariaDB, WP-CLI and n8n on one network. All business logic (mapping, validation, stage mapping, aggregates, HMAC, backoff) lives in pure ESM modules under `src/lib/` tested with `node:test`; `scripts/build-workflows.mjs` inlines those modules into the n8n Code nodes of `workflows/*.template.json`, so the logic tested is the logic that runs. HubSpot calls go through one n8n sub-workflow (`hubspot-request`) that does batching-friendly HTTP + 429/5xx exponential backoff; HubSpot schema (properties, pipelines) is created by an idempotent setup script, not by hand.

**Tech Stack:** Docker Compose (official `wordpress`, `mariadb`, `wordpress:cli`, `n8nio/n8n` images) · WooCommerce REST API v3 + webhooks · n8n (Code, HTTP Request, Webhook, Execute Workflow, Wait, Error Trigger) · HubSpot CRM API v3 objects + v4 associations, auth by Service Key · Node 24 (built-in `fetch`, `node:test`, `node:crypto`) — **zero npm dependencies**.

**Spec:** project brief (private notes, not part of this repo).

**Repo:** this repository (branch `main`).

## Global Constraints

- USD 0. No paid plugins, no paid HubSpot tier (test account trial only).
- Auth = HubSpot **Service Key**. Private apps cannot be created since 2026-10-26.
- Never real customer data. Never secrets in the repo: `.env` and n8n credentials are gitignored; exported workflows must contain no credential values (only credential *names*).
- No third-party npm packages. Docker images only from official publishers (`wordpress`, `mariadb`, `n8nio/n8n`), pinned by tag.
- Rate limit ceiling: **100 requests / 10 s**. Batches of max 100 inputs (2000 for association batch).
- n8n's HubSpot node lacks line items/products/associations → all HubSpot calls use HTTP Request with the credential type "HubSpot App Token" (batch endpoints = fewer requests; one code path).
- Idempotency keys: contact `email`; company `domain` (search before create); product `woo_product_id`; deal `woo_order_id`; line item `woo_line_item_id`.
- Status → stage: `pending`,`on-hold` → Pending payment · `processing` → Paid · `completed` → Closed won · `cancelled`,`failed` → Closed lost · `refunded` → Refunded (amount 0, `refund_amount` = refunded total).
- Free email domains never create companies: gmail.com, googlemail.com, hotmail.com, outlook.com, live.com, yahoo.com, yahoo.com.ar, icloud.com, aol.com, proton.me, protonmail.com.
- Data quality never blocks the sync: invalid fields are dropped from the HubSpot payload, the record is flagged.
- Code, commits, README and case study in English; small commits, docs separate from code.

## Design decisions (fixed here, explained in README)

| Decision | Choice | Why |
|---|---|---|
| Where totals live | n8n computes `total_orders`, `total_revenue`, `first_order_date`, `last_order_date` from Woo (source of truth) | Rollup calc properties vary by tier; Woo knows refunds |
| `customer_segment` | Set by HubSpot workflow W1 (new / repeat ≥2 orders / VIP `total_revenue` > **1000**) | Shows HubSpot automation, per spec |
| Paid orders | statuses `processing`,`completed`; revenue = `total − refunded` | Refunds never count as revenue |
| "Needs review" | contact props `data_quality_status` (`ok`/`needs_review`) + `data_quality_issues` (text) + active list filtering on it | No lists scope needed; reportable |
| Sync error log | HubSpot **ticket** in pipeline "Integration errors" (subject = reason, content = payload excerpt) + optional Telegram | Reportable in dashboard (report 6); visible to non-tech staff |
| Woo → n8n webhooks on a private network | mu-plugin allows host `n8n` (`http_request_host_is_external`) and synchronous delivery | Woo blocks private hosts by default |
| Backdated orders | generator writes JSON (Node, seeded, tested); a PHP loader run by WP-CLI creates them with WC CRUD and `set_date_created` | REST makes `date_created` read-only; dashboard needs 12 months |

## Review Focus

1. **Same order delivered twice / backfill re-run** → exactly one deal and one line item per Woo item. Pinned by `buildDealInput`/`buildLineItemInputs` determinism tests (Task 3) and the duplicate check in `verify-hubspot.mjs` (Task 10) run after a second backfill.
2. **Partial refund on a `completed` order** → stays Closed won, amount = total − refunded, `refund_amount` set. Test in Task 3.
3. **Guest order with dirty data** (`juan@gmial.con`, phone `011 4444-5555`, country `Argentina`) → contact still synced with valid fields, flagged `needs_review` with all issues listed; invalid email → order synced without contact + ticket. Tests in Task 2 and Task 3.
4. **Two orders from the same company domain in one batch** → one company. Test `planCompanies` dedupes within batch (Task 3).
5. **429 storm during backfill** → no lost batch: retried with 1 s/2 s/4 s waits, then ticket. Test `backoffDelayMs` + `shouldRetry` (Task 4) and the forced-429 run in Task 7.

---

### Task 1: Repo scaffold + local stack (no HubSpot needed)

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `.gitignore`, `package.json` (scripts only, no deps), `wordpress/mu-plugins/wc-hubspot-demo.php`, `scripts/setup-woo.sh`

**Interfaces:**
- Produces: WordPress at `http://localhost:8080` (admin user from `.env`), n8n at `http://localhost:5678`, Woo reachable from n8n as `http://wordpress`, n8n reachable from WP as `http://n8n:5678`. `.env` keys: `WP_ADMIN_USER`, `WP_ADMIN_PASSWORD`, `WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET`, `WOO_WEBHOOK_SECRET`, `HUBSPOT_SERVICE_KEY`, `TELEGRAM_BOT_TOKEN` (optional), `TELEGRAM_CHAT_ID` (optional). `npm test` → `node --test src/`.

- [ ] **Step 1:** `docker-compose.yml` with services `db` (mariadb:11.4), `wordpress` (wordpress:6.8-php8.3-apache, port 8080, mounts mu-plugins), `wpcli` (wordpress:cli-php8.3, profile `tools`, same volumes), `n8n` (n8nio/n8n pinned, port 5678, env `NODE_FUNCTION_ALLOW_BUILTIN=crypto`, `GENERIC_TIMEZONE=America/Argentina/Buenos_Aires`, volume `n8n_data`, mount `./workflows` read-only at `/workflows`). Pin exact tags after `docker pull` and write them in the file.
- [ ] **Step 2:** mu-plugin: `add_filter('http_request_host_is_external', fn($ok,$host)=> $ok || $host==='n8n', 10, 2)` and `add_filter('woocommerce_webhook_deliver_async','__return_false')`.
- [ ] **Step 3:** `scripts/setup-woo.sh` (runs via `docker compose run --rm wpcli`): core install, install+activate WooCommerce from wordpress.org, enable HPOS (`wp option update woocommerce_custom_orders_table_enabled yes`), currency USD, import Woo's bundled `sample-data/sample_products.csv`, create REST key (read/write) and print it once to the terminal for `.env`. Idempotent (skips steps already done).
- [ ] **Step 4: Verify:** `docker compose up -d && bash scripts/setup-woo.sh`; then `curl -u "$WOO_CONSUMER_KEY:$WOO_CONSUMER_SECRET" "http://localhost:8080/wp-json/wc/v3/products?per_page=1"` returns one product; `curl -s localhost:5678/healthz` returns `{"status":"ok"}`.
- [ ] **Step 5: Commit** `chore: docker stack with WooCommerce (HPOS) and n8n`.

### Task 2: Validation (F3 core)

**Files:** Create `src/lib/validate.js`, `src/lib/validate.test.js`

**Interfaces:**
- Produces: `validateEmail(raw: string) -> {value: string|null, issue: string|null}` (lowercases/trims; issues `email_invalid_format`, `email_disposable`, `email_typo_domain` with suggestion e.g. `gmial.com→gmail.com`); `normalizePhone(raw: string, countryIso2: string|null) -> {value: string|null, issue: string|null}` (E.164; AR default `+54`; issue `phone_invalid`); `normalizeCountry(raw: string) -> {value: string|null, issue: string|null}` (ISO-2 from code or common EN/ES name; issue `country_unknown`); `validateCustomer(billing) -> {clean: {email, phone, country, firstname, lastname, company}, issues: string[]}`.

- [ ] **Step 1: Failing tests** (`node --test src/lib/validate.test.js`):
  - `validateEmail(' Ana@Example.COM ')` → `{value:'ana@example.com', issue:null}`
  - `validateEmail('juan@gmial.con')` → `value:null`, issue starts with `email_typo_domain`
  - `validateEmail('x@mailinator.com')` → `issue:'email_disposable'`
  - `normalizePhone('011 4444-5555','AR')` → `'+541144445555'`; `normalizePhone('abc','AR')` → `issue:'phone_invalid'`
  - `normalizeCountry('Argentina')` and `('ar')` → `'AR'`; `('Narnia')` → `issue:'country_unknown'`
  - `validateCustomer` with bad phone + good email → `clean.phone===null`, `issues` equals `['phone_invalid']`, email kept.
- [ ] **Step 2:** run, expect FAIL (module not found).
- [ ] **Step 3:** implement. Disposable list: small inline set (mailinator.com, 10minutemail.com, guerrillamail.com, yopmail.com, tempmail.com). Typo map: gmial/gmal/gnail→gmail, hotmial/hotmal→hotmail, `.con`/`.cmo`→`.com`. Country map covers the generator's countries (AR, US, MX, ES, CL, UY, BR, CO, PE, GB, DE) in EN+ES.
- [ ] **Step 4:** run, expect PASS.
- [ ] **Step 5: Commit** `feat: customer data validation (email, phone E.164, country ISO-2)`.

### Task 3: Woo → HubSpot mapping

**Files:** Create `src/lib/mapping.js`, `src/lib/mapping.test.js`, `src/lib/fixtures/order-*.json` (3 trimmed real-shape Woo orders: completed with company, guest partial refund, refunded)

**Interfaces:**
- Consumes: `validateCustomer` (Task 2).
- Produces: `STAGE_BY_STATUS` (status → stage *internal key* `pending_payment|paid|closedwon|closedlost|refunded`; Task 5 maps keys to real HubSpot stage ids via `stageIds` arg); `companyDomain(email: string) -> string|null`; `planCompanies(orders) -> Array<{domain, name}>` (deduped by domain); `buildContactInput(order) -> {email|null, properties, issues}`; `buildProductInputs(orders) -> Array<{idProperty:'woo_product_id', id, properties}>`; `buildDealInput(order, {pipelineId, stageIds}) -> {idProperty:'woo_order_id', id, properties}`; `buildLineItemInputs(order) -> Array<{idProperty:'woo_line_item_id', id, properties, wooProductId}>`; `aggregateCustomer(orders) -> {total_orders, total_revenue, first_order_date, last_order_date}`.

- [ ] **Step 1: Failing tests:**
  - stage mapping for all 7 Woo statuses (exact table in Global Constraints).
  - `companyDomain('a@acme.io')==='acme.io'`, `companyDomain('a@gmail.com')===null`.
  - `planCompanies` with two orders `@acme.io` → length 1.
  - `buildDealInput(refundedOrder)` → `properties.amount==='0'`, `refund_amount` = order refunded total, `dealstage === stageIds.refunded`.
  - `buildDealInput(partialRefundCompleted)` → stage `closedwon`, `amount === (total − refunded).toFixed(2)`, `refund_amount` set.
  - `buildDealInput` sets `closedate` = order `date_created_gmt` ISO, `dealname` = `Woo #<number> — <billing name>`, `woo_order_id` = string id; calling it twice on the same order returns deep-equal output.
  - `buildLineItemInputs` → one per item, `woo_line_item_id` = item id, `quantity`, `price`, `name`, `hs_sku`.
  - `aggregateCustomer` over [completed 100, processing 50 refunded 20, cancelled 999] → `{total_orders:2, total_revenue:130, ...}`.
  - `buildContactInput` with typo email → `email:null`, issues include `email_typo_domain…`.
- [ ] **Step 2:** run, FAIL. **Step 3:** implement. **Step 4:** run, PASS.
- [ ] **Step 5: Commit** `feat: map Woo orders to HubSpot contacts, companies, products, deals, line items`.

### Task 4: Webhook signature + backoff helpers

**Files:** Create `src/lib/webhook.js`, `src/lib/retry.js`, tests next to them.

**Interfaces:**
- Produces: `verifyWooSignature(rawBody: string, signatureHeader: string, secret: string) -> boolean` (base64 HMAC-SHA256, `crypto.timingSafeEqual`); `shouldRetry(status: number) -> boolean` (429 and 500-599); `backoffDelayMs(attempt: 1|2|3, retryAfterHeader?: string) -> number` (1000·2^(attempt−1), Retry-After seconds wins if present); `chunk(arr, size) -> arr[][]`.

- [ ] **Step 1: Failing tests:** signature computed in-test with `node:crypto` validates; tampered body fails; wrong-length header returns false (no throw). `shouldRetry(429)`, `(503)` true; `(400)`, `(409)` false. `backoffDelayMs(1)=1000, (3)=4000, (2,'7')=7000`. `chunk([1..250],100)` lengths `[100,100,50]`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: Woo webhook HMAC verification and retry helpers`.

### Task 5: Fake-data generator (~200 orders)

**Files:** Create `scripts/generate-orders.mjs`, `src/lib/generator.js`, `src/lib/generator.test.js`, `wordpress/load-orders.php`; output `data/orders.json` (gitignored? **no** — committed, it is fake and makes the demo reproducible).

**Interfaces:**
- Produces: `generateOrders({seed: number, count: number, products: Array<{id, price}>, now: Date}) -> Order[]` where each order has `{customer:{first_name,last_name,email,phone,country,company}, status, date_created, items:[{product_id, quantity}], refund_amount}`; `scripts/generate-orders.mjs --seed 42 --count 200` fetches products from Woo REST and writes `data/orders.json`; `wp eval-file /var/www/html/load-orders.php /data/orders.json` creates them with `wc_create_order`, `set_date_created`, `set_status`, `wc_create_refund`, and stores the generator id in order meta `_demo_gen_id` (skip if exists → re-runnable).

- [ ] **Step 1: Failing tests:** same seed → deep-equal output; 200 orders; ~120 unique customers (between 100 and 140) so repeat buyers exist; ≥5 customers whose revenue > 1000 (VIP); status mix within ±5 of: completed 110, processing 30, pending/on-hold 15, cancelled/failed 20, refunded 15, plus 10 completed with partial refund; ≥15 orders with dirty data (typo email, disposable email, bad phone, country as full name); ~25% of customers have a company with a non-free domain, ≥3 share a domain; dates span the 12 months before `now`. Names/companies from small inline lists (fictional — e.g. "Acme Andina SRL"), domains on `.example`/`.test` style TLDs that are not real businesses.
- [ ] **Step 2–4:** FAIL → implement (tiny seeded PRNG, mulberry32) → PASS.
- [ ] **Step 5: Verify load:** generate, load, then `curl …/wc/v3/orders?per_page=1` header `X-WP-Total: 200`; re-run loader → still 200.
- [ ] **Step 6: Commit** `feat: seeded fake order generator and WP-CLI loader` (data/orders.json in a separate commit `chore: generated demo dataset (seed 42)`).

### Task 6: HubSpot schema setup (needs Service Key) — blocked until a Service Key exists

**Files:** Create `scripts/hubspot-setup.mjs`, `src/lib/hubspot-schema.js` (pure definitions), `src/lib/hubspot-schema.test.js`

**Interfaces:**
- Produces (written to `.hubspot-ids.json`, gitignored, and printed): `{pipelineId, stageIds:{pending_payment,paid,closedwon,closedlost,refunded}, ticketPipelineId, ticketStageNewId}`.
- Properties created (group `woocommerce`): contacts `woo_customer_id`, `total_orders`(number), `total_revenue`(number), `first_order_date`(date), `last_order_date`(date), `customer_segment`(enum new/repeat/vip), `data_quality_status`(enum ok/needs_review), `data_quality_issues`(text); deals `woo_order_id` (unique), `refund_amount`(number), `woo_status`(text), `last_sync_error_at`(datetime); products `woo_product_id` (unique); line items `woo_line_item_id` (unique). Deal pipeline "WooCommerce" with the 5 stages (Closed won probability 1, Closed lost/Refunded probability 0, closed). Ticket pipeline "Integration errors" with stages New / Resolved.

- [ ] **Step 1: Failing test:** schema definitions contain every property above with the exact names/types; unique flags only on the 3 id props.
- [ ] **Step 2–4:** FAIL → implement → PASS. Script is idempotent: GET first, create only missing (409 = already exists = OK).
- [ ] **Step 5: Verify:** `node --env-file=.env scripts/hubspot-setup.mjs` twice; second run prints "0 created". If unique property on line items is rejected (400), fall back: no unique flag, and the line-item step in Task 7 searches existing line items of the deal by `woo_line_item_id` and updates instead of upserting — record this in README "What went wrong".
- [ ] **Step 6: Commit** `feat: idempotent HubSpot schema setup (properties, pipelines)`.

### Task 7: n8n workflows F1 (backfill) + F4 (hubspot-request, errors)

**Files:** Create `workflows/hubspot-request.template.json`, `workflows/error-handler.template.json`, `workflows/f1-backfill.template.json`, `scripts/build-workflows.mjs`, `scripts/build-workflows.test.mjs`; output `workflows/dist/*.json` (committed: these are the exported, credential-free workflows).

**Interfaces:**
- Consumes: all `src/lib` exports; `.hubspot-ids.json`.
- Produces: `build-workflows.mjs` replaces any Code node `jsCode` line `// @inline <path>` with the module source (strip `export ` keywords; join helpers) and fails if a referenced file is missing or if any value matching `/pat-|Bearer |[A-Za-z0-9]{32,}/` appears in output (secret guard). Sub-workflow `hubspot-request` input `{method, path, body}` → output `{status, body}`; retries per `shouldRetry`/`backoffDelayMs`, max 3, then throws `HubSpotRequestError(status, path, bodyExcerpt)`. `error-handler` (Error Trigger) creates a ticket in "Integration errors" + optional Telegram message if `TELEGRAM_*` set.
- F1 order: page Woo orders (100/page, `orderby=id&order=asc`, resume from n8n static data `lastPage`) → per page: validate → contacts batch upsert (idProperty email) with aggregates computed over the full Woo history of those emails → companies (search `domain IN [...]`, batch create missing) → products batch upsert → deals batch upsert → line items batch upsert → associations batch default (contact–company, deal–contact, deal–company, line item–deal) → save `lastPage`.

- [ ] **Step 1: Failing test** for build script: template with `// @inline src/lib/retry.js` produces jsCode containing `function backoffDelayMs`; a template with a fake `pat-na1-…` string makes the build exit non-zero.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Author templates; `npm run build:workflows`; import into n8n (`docker compose exec n8n n8n import:workflow --separate --input=/workflows/dist`); the operator creates credential "HubSpot App Token" (named `HubSpot Service Key`) and "WooCommerce API" in the n8n UI.
- [ ] **Step 6: Verify F1:** run backfill → HubSpot deal count in pipeline WooCommerce = 200; run again → still 200, line items unchanged (Review Focus 1). Force 429: temporarily set batch size 10 and no wait → executions show retries, no ticket unless 3 fails (Review Focus 5). Restore.
- [ ] **Step 7: Commit** `feat: n8n backfill and HubSpot request sub-workflow with backoff` + `chore: exported workflows (no credentials)`.

### Task 8: F2 real-time (webhooks)

**Files:** Create `workflows/f2-realtime.template.json`; modify `scripts/setup-woo.sh` (creates webhooks `order.created`, `order.updated` → `http://n8n:5678/webhook/woo-orders` with `WOO_WEBHOOK_SECRET`).

**Interfaces:** Consumes `verifyWooSignature`, mapping, `hubspot-request`. Webhook node with Raw Body on; bad signature → 401 and stop; Woo's ping on webhook creation (`webhook_id` body) → 200 and stop.

- [ ] **Step 1:** build, import, activate.
- [ ] **Step 2: Verify:** create an order in wp-admin → deal appears in < 30 s in Paid/Pending; mark Completed → stage Closed won; full refund → Refunded, amount 0; partial refund → amount reduced; `curl` with wrong signature → 401, no deal (all documented with execution screenshots for README).
- [ ] **Step 3: Commit** `feat: real-time order sync via signed Woo webhooks`.

### Task 9: HubSpot workflows W1/W2 + Needs-review list + dashboard (UI, via the HubSpot UI)

**Files:** Create `docs/hubspot-config.md` (exact trigger/branch/action definitions, so anyone can rebuild them).

- [ ] **Step 1: W1 "Woo lifecycle"** (deal-based, enroll when stage = Closed won in pipeline WooCommerce): associated contact lifecycle → Customer; branch on contact `total_revenue` > 1000 → segment `vip` + task "Call VIP customer" for owner; else `total_orders` ≥ 2 → `repeat`; else `new`. Re-enrollment on.
- [ ] **Step 2: W2 "Win-back"** (contact-based: `last_order_date` more than 90 days ago AND lifecycle = Customer) → add to static list "At risk" + task "Win-back call". No emails.
- [ ] **Step 3:** active list "Needs review" (`data_quality_status = needs_review`).
- [ ] **Step 4: Dashboard "WooCommerce Revenue"** with: (1) revenue by month, Closed won, by close date; (2) AOV = avg amount Closed won; (3) % repeat customers (contacts by `customer_segment`, Customer lifecycle); (4) deals by stage, pipeline WooCommerce; (5) top 10 products by line item amount; (6) Needs review contacts count + Integration-errors tickets created this week.
- [ ] **Step 5: Verify:** a test contact with 2 Closed won deals ends `repeat`; a VIP one gets the task; numbers in report 1 summed equal `verify-hubspot.mjs` revenue.
- [ ] **Step 6: Commit** `docs: HubSpot workflows, lists and dashboard configuration`.

### Task 10: Verification numbers, README, case study, screenshots

**Files:** Create `scripts/verify-hubspot.mjs`, `README.md`, `docs/case-study.md`, `docs/architecture.md` (Mermaid diagram), `docs/screenshots/*.png` (3-4).

**Interfaces:** `verify-hubspot.mjs` prints JSON `{orders_in_woo, deals_in_hubspot, duplicate_woo_order_ids, contacts, companies, needs_review, integration_error_tickets, closed_won_revenue}` and exits 1 if `duplicate_woo_order_ids > 0` or counts mismatch.

- [ ] **Step 1:** write + run `verify-hubspot.mjs`; exit 0.
- [ ] **Step 2:** README: what it is (1 paragraph), Mermaid diagram, quickstart (compose → setup-woo → generate → setup HubSpot → import workflows), mapping table, decisions table, comparison vs the native app (from spec §1), "What went wrong" (real incidents logged during Tasks 1-9 — keep a running list in `docs/incidents.md` from Task 1 on), limits (test account expiry, Service Key beta).
- [ ] **Step 3:** case study filled with the numbers from Step 1 (template in spec).
- [ ] **Step 4:** screenshots: pipeline board, contact record with deal history, dashboard, n8n backfill execution. No real personal data visible (all fake anyway; portal id blurred).
- [ ] **Step 5: Secret audit before going public:** `git log -p | grep -E "pat-|Bearer|consumer_secret|cs_[a-f0-9]{20}"` returns nothing; `.env`, `.hubspot-ids.json` never committed.
- [ ] **Step 6: Commit** docs. Publish after the secret audit.
