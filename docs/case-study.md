# WooCommerce → HubSpot: a sync your sales team can trust

**The problem.** A store sells on WooCommerce, but sales and marketing work in HubSpot. Orders don't show
up as deals, the same customer appears three times, refunds still count as revenue, and nobody trusts the
reports.

**What I built.** An n8n integration that syncs customers, orders and products into HubSpot in real time
and backfills past orders. Every order is synced exactly once (even if it's retried), refunds update the
deal, and bad data goes to a review list instead of polluting the CRM. HubSpot workflows then mark
first-time, repeat and VIP customers automatically, and flag customers who haven't bought in 90 days.

**The result.** 217 orders and 128 customers synced with zero duplicates — after repeated backfills and
bursts of simultaneous order events. 9 companies, exactly one per business. 18 records caught by validation
(9 contacts sent to review, 9 orders with an unusable email turned into tickets). One dashboard with revenue
by month, average order value (451 USD), repeat and VIP rates, and data-quality alerts — every number
matching the independent check script. *(Test data — numbers from the demo store.)*

**What went wrong and how I fixed it.**
- The first real run synced deals but no customers: HubSpot rejected the test email domain and, with it,
  each whole batch of 100. Because errors become tickets with HubSpot's exact message, the cause took a
  minute to find; the fix took ten.
- Under load, 43 order events at once created duplicate companies. The check script caught it; switching
  to a unique key that HubSpot itself enforces made duplicates impossible, and a repeat of the same burst
  produced exactly one company.
- A HubSpot built-in field (`total_revenue`) turned out to be read-only; the setup now refuses to touch
  fields HubSpot owns.

**Stack.** WooCommerce REST API & webhooks · n8n · HubSpot CRM API (contacts, companies, deals, line
items, associations) · HubSpot workflows & reports.
