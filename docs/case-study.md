# WooCommerce → HubSpot: a sync your sales team can trust

> DRAFT — the numbers in **[brackets]** are filled from `node scripts/verify-hubspot.mjs` after the run
> against the HubSpot test account. Test data: numbers come from the demo store, not a real client.

**The problem.** A store sells on WooCommerce, but sales and marketing work in HubSpot. Orders don't show
up as deals, the same customer appears three times, refunds still count as revenue, and nobody trusts the
reports.

**What I built.** An n8n integration that syncs customers, orders and products into HubSpot in real time
and backfills past orders. Every order is synced exactly once (even if it's retried), refunds update the
deal, and bad data goes to a review list instead of polluting the CRM. HubSpot workflows then mark
first-time, repeat and VIP customers automatically.

**The result.** [200] orders and [111] customers synced with zero duplicates, re-run twice with identical
counts; [6] companies, one per business domain; [18] records caught by validation ([9] contacts flagged
for review, [9] orders whose email could not be used); one dashboard with revenue, average order value and
repeat rate. *(Test data — numbers from the demo store.)*

**What went wrong and how I fixed it.**
- HubSpot does not dedupe companies created through the API → the sync searches by domain before
  creating, so 30 company buyers became exactly [6] companies.
- WooCommerce silently refused to deliver webhooks to the integration (it blocks private hosts *and*
  non-standard ports) → a 10-line must-use plugin allows exactly that host and port.
- The first error alerts only said "Error executing workflow" → alerts now carry the real cause
  (e.g. "HTTP 503 after 3 attempts") and a link to the failed run, as a ticket the team can work.

**Stack.** WooCommerce REST API & webhooks · n8n · HubSpot CRM API (contacts, companies, deals, line
items, associations) · HubSpot workflows & reports.
