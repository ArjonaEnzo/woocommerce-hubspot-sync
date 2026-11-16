# HubSpot configuration (workflows, lists, dashboard)

Everything the sync writes through the API is created by `scripts/hubspot-setup.mjs`. The pieces below
live in HubSpot's UI (workflows, lists and reports are not part of the CRM objects API), so they are
written down here precisely enough to rebuild them by hand in a few minutes.

Portal: a HubSpot **developer test account** (free, 90-day Enterprise trial). Workflows need a
Professional or Enterprise hub; a Free portal does not have them.

## W1 — "Woo lifecycle & segments"

- **Type:** deal-based workflow.
- **Enrollment trigger:** Deal stage is *Closed won* (pipeline *WooCommerce*).
- **Re-enrollment:** on, same trigger (a customer can win many deals).
- **Actions:**
  1. *Edit record* → associated contact → Lifecycle stage = **Customer**.
  2. *If/then branch* on the associated contact:
     - `total_revenue` **is greater than 1000** → set `customer_segment` = **VIP** → *Create task*
       "Call VIP customer" (assigned to the contact owner, due in 2 business days).
     - else `total_orders` **is greater than or equal to 2** → set `customer_segment` = **Repeat**.
     - else → set `customer_segment` = **New**.

Why the totals come from the sync and not from a rollup property: refunds. The sync computes
`total_revenue` from WooCommerce net of refunds, which is the number the business trusts.

## W2 — "Win-back (90 days)"

- **Type:** contact-based workflow.
- **Enrollment trigger:** Lifecycle stage is *Customer* **and** `last_order_date` is more than 90 days ago.
- **Re-enrollment:** on, when `last_order_date` changes.
- **Actions:**
  1. Add to static list **At risk**.
  2. *Create task* "Win-back call" for the contact owner.
- No marketing emails are sent (test account; and the demo must not email anyone).

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
