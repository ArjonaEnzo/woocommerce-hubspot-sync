# HubSpot configuration (workflows, lists, dashboard)

Everything the sync writes through the API is created by `scripts/hubspot-setup.mjs`. The pieces below
live in HubSpot's UI (workflows, lists and reports are not part of the CRM objects API), so they are
written down here precisely enough to rebuild them by hand in a few minutes.

Portal: a HubSpot **developer test account** (free, 90-day Enterprise trial). Workflows need a
Professional or Enterprise hub; a Free portal does not have them.

## Before the first sync: one setting

**Settings → Objects → Companies → "Create and associate companies with contacts": OFF.**
It is on by default. With it on, HubSpot creates a company from every new contact's email domain on its
own, and the sync's search (which runs seconds later, before HubSpot's search index catches up) does not
see it → duplicate companies. The sync is meant to be the only writer of companies; `verify-hubspot.mjs`
reports duplicate companies, products and line items if any appear.

## W1 — "Woo lifecycle & segments"

- **Type:** deal-based workflow.
- **Enrollment trigger:** Deal stage is *Closed won* (pipeline *WooCommerce*).
- **Re-enrollment:** off — the workflow is per deal and a deal is won once; each new won deal enrolls on its own.
- **Activated** 2026-11-16 with "enroll existing records": 110 Closed won deals → 67 contacts became Customer
  (New 39 · Repeat 12 · VIP 16); 0 contacts whose segment disagrees with their synced totals (checked by API).
- **Actions:**
  1. *Edit record* → associated contact → Lifecycle stage = **Customer**.
  2. *If/then branch* on the associated contact:
     - `woo_total_revenue` **is greater than 1000** → set `customer_segment` = **VIP** → *Create task*
       "Call VIP customer" (due in 2 business days; unassigned — the demo contacts have no owner).
     - else `total_orders` **is greater than or equal to 2** → set `customer_segment` = **Repeat**.
     - else → set `customer_segment` = **New**.

Why the totals come from the sync and not from a rollup property: refunds. The sync computes
`woo_total_revenue` from WooCommerce net of refunds, which is the number the business trusts.

## W2 — "Win-back (90 days)"

- **Type:** contact-based workflow.
- **Enrollment trigger:** Lifecycle stage is *Customer* **and** `last_order_date` is more than 90 days ago.
- **Re-enrollment:** on (HubSpot only allows re-enrolling on the lifecycle condition, not on a relative date).
- **Activated** 2026-11-16 with "enroll existing records": 39 contacts matched.
- **Actions:**
  1. Add to static list **At risk**.
  2. *Create task* "Win-back call" (unassigned, see above).
- No marketing emails are sent (test account; and the demo must not email anyone).

## Segment — "At risk"

- **Type:** static contact segment, filled only by W2.

## List — "Needs review"

- **Type:** active (dynamic) contact list.
- **Filter:** `data_quality_status` is **Needs review**.
- Contacts land here when the sync dropped an invalid phone or country (the field is listed in
  `data_quality_issues`). Orders whose email itself is invalid have no contact; they show up as tickets
  in the *Integration errors* pipeline instead.

## Dashboard — "WooCommerce Revenue"

| # | Report | Object · type | Filters | Measure / grouping |
|---|---|---|---|---|
| 1 | Revenue by month | Deals · column | Pipeline = WooCommerce, Stage = Closed won | Sum of Amount by Close date (monthly) |
| 2 | Average order value | Deals · single value | Pipeline = WooCommerce, Stage = Closed won | Average of Amount |
| 3 | Repeat customer rate | Contacts · donut | Lifecycle stage = Customer | Count by `customer_segment` |
| 4 | Deals by stage | Deals · funnel/bar | Pipeline = WooCommerce | Count by Deal stage |
| 5 | Top 10 products by revenue | Line items · bar | Associated deal stage = Closed won | Sum of Amount by Name, top 10 |
| 6 | Data quality this week | Contacts + Tickets · single values | `data_quality_status` = Needs review · Tickets in *Integration errors* created this week | Count |
