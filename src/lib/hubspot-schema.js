// HubSpot schema the sync needs. Created idempotently by scripts/hubspot-setup.mjs.

export const PROPERTY_GROUP = { name: 'woocommerce', label: 'WooCommerce', displayOrder: -1 };

const base = { groupName: PROPERTY_GROUP.name };
const text = (name, label, extra = {}) => ({ ...base, name, label, type: 'string', fieldType: 'text', ...extra });
const number = (name, label) => ({ ...base, name, label, type: 'number', fieldType: 'number' });
const date = (name, label) => ({ ...base, name, label, type: 'date', fieldType: 'date' });
const select = (name, label, values) => ({
  ...base, name, label, type: 'enumeration', fieldType: 'select',
  options: values.map(([value, optionLabel], displayOrder) => ({ value, label: optionLabel, displayOrder })),
});
const uniqueId = (name, label) => text(name, label, { hasUniqueValue: true });

export const PROPERTIES = {
  contacts: [
    text('woo_customer_id', 'Woo customer ID'),
    number('total_orders', 'Total orders (paid)'),
    // Not 'total_revenue': that name is a read-only HubSpot default property on contacts.
    number('woo_total_revenue', 'Woo total revenue (net of refunds)'),
    date('first_order_date', 'First order date'),
    date('last_order_date', 'Last order date'),
    select('customer_segment', 'Customer segment', [['new', 'New'], ['repeat', 'Repeat'], ['vip', 'VIP']]),
    select('data_quality_status', 'Data quality status', [['ok', 'OK'], ['needs_review', 'Needs review']]),
    text('data_quality_issues', 'Data quality issues', { type: 'string', fieldType: 'textarea' }),
  ],
  // Upsert key for companies: one per business email domain, enforced by HubSpot (HubSpot's own `domain`
  // property is not unique, and companies created through the API are not deduplicated).
  companies: [uniqueId('woo_company_domain', 'Woo company domain')],
  deals: [
    uniqueId('woo_order_id', 'Woo order ID'),
    number('refund_amount', 'Refund amount'),
    text('woo_status', 'Woo order status'),
  ],
  // HubSpot does not support unique-value properties on products (and does not document them for line
  // items), so these two are looked up by search and then updated or created — see sync-plan.js.
  products: [text('woo_product_id', 'Woo product ID')],
  line_items: [text('woo_line_item_id', 'Woo line item ID')],
  // One ticket per distinct sync problem, so re-running the backfill never duplicates tickets.
  tickets: [uniqueId('sync_error_key', 'Sync error key')],
};

const stage = (key, label, displayOrder, metadata) => ({ key, label, displayOrder, metadata });

export const DEAL_PIPELINE = {
  label: 'WooCommerce',
  displayOrder: 1,
  stages: [
    stage('pending_payment', 'Pending payment', 0, { probability: '0.2' }),
    stage('paid', 'Paid', 1, { probability: '0.9' }),
    stage('closedwon', 'Closed won', 2, { probability: '1.0' }),
    stage('closedlost', 'Closed lost', 3, { probability: '0.0' }),
    stage('refunded', 'Refunded', 4, { probability: '0.0' }),
  ],
};

export const TICKET_PIPELINE = {
  label: 'Integration errors',
  displayOrder: 1,
  stages: [
    stage('new', 'New', 0, { ticketState: 'OPEN' }),
    stage('resolved', 'Resolved', 1, { ticketState: 'CLOSED' }),
  ],
};
