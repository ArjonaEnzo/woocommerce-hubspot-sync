// WooCommerce order → HubSpot CRM inputs. Pure functions, inlined into n8n Code nodes.
import { validateCustomer, validateEmail } from './validate.js';

// Woo status → internal stage key. Real HubSpot stage ids come from hubspot-setup (.hubspot-ids.json).
export const STAGE_BY_STATUS = {
  pending: 'pending_payment',
  'on-hold': 'pending_payment',
  processing: 'paid',
  completed: 'closedwon',
  cancelled: 'closedlost',
  failed: 'closedlost',
  refunded: 'refunded',
};

const PAID_STATUSES = new Set(['processing', 'completed']);

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'yahoo.com.ar',
  'icloud.com', 'aol.com', 'proton.me', 'protonmail.com',
]);

const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

export function refundTotal(order) {
  return (order.refunds ?? []).reduce((sum, r) => sum + Math.abs(Number(r.total) || 0), 0);
}

export function netTotal(order) {
  return Math.max(0, Number(order.total) - refundTotal(order));
}

const isoUtc = (wooGmtDate) => new Date(`${wooGmtDate}Z`).toISOString();

export function companyDomain(email) {
  const { value } = validateEmail(email);
  if (!value) return null;
  const domain = value.split('@')[1];
  return FREE_EMAIL_DOMAINS.has(domain) ? null : domain;
}

export function planCompanies(orders) {
  const byDomain = new Map();
  for (const order of orders) {
    const domain = companyDomain(order.billing?.email);
    if (!domain) continue;
    const name = String(order.billing?.company ?? '').trim();
    const existing = byDomain.get(domain);
    if (!existing || (existing.name === domain && name)) byDomain.set(domain, { domain, name: name || domain });
  }
  return [...byDomain.values()];
}

export function buildContactInput(order) {
  const { clean, issues } = validateCustomer(order.billing);
  const properties = {};
  for (const [key, value] of Object.entries(clean)) if (value) properties[key] = value;
  if (Number(order.customer_id) > 0) properties.woo_customer_id = String(order.customer_id);
  properties.data_quality_status = issues.length ? 'needs_review' : 'ok';
  properties.data_quality_issues = issues.join('; ');
  return { email: clean.email, properties, issues };
}

export function buildProductInputs(orders) {
  const byId = new Map();
  for (const order of orders) {
    for (const item of order.line_items ?? []) {
      const id = String(item.product_id);
      if (byId.has(id)) continue;
      byId.set(id, {
        idProperty: 'woo_product_id',
        id,
        properties: { woo_product_id: id, name: item.name, price: money(Number(item.price)), hs_sku: item.sku || undefined },
      });
    }
  }
  return [...byId.values()];
}

export function buildDealInput(order, { pipelineId, stageIds }) {
  const stageKey = STAGE_BY_STATUS[order.status];
  if (!stageKey) throw new Error(`Unknown Woo status "${order.status}" on order ${order.id}`);
  const id = String(order.id);
  const name = [order.billing?.first_name, order.billing?.last_name].filter(Boolean).join(' ').trim();
  return {
    idProperty: 'woo_order_id',
    id,
    properties: {
      woo_order_id: id,
      dealname: `Woo #${order.number ?? id}${name ? ` — ${name}` : ''}`,
      pipeline: pipelineId,
      dealstage: stageIds[stageKey],
      amount: order.status === 'refunded' ? money(0) : money(netTotal(order)),
      refund_amount: money(refundTotal(order)),
      closedate: isoUtc(order.date_created_gmt),
      woo_status: order.status,
      deal_currency_code: order.currency,
    },
  };
}

export function buildLineItemInputs(order) {
  return (order.line_items ?? []).map((item) => {
    const id = String(item.id);
    return {
      idProperty: 'woo_line_item_id',
      id,
      wooProductId: String(item.product_id),
      properties: {
        woo_line_item_id: id,
        name: item.name,
        quantity: String(item.quantity),
        price: money(Number(item.price)),
        hs_sku: item.sku || undefined,
      },
    };
  });
}

export function aggregateCustomer(orders) {
  const paid = orders.filter((o) => PAID_STATUSES.has(o.status));
  const dates = paid.map((o) => o.date_created_gmt.slice(0, 10)).sort();
  return {
    total_orders: paid.length,
    woo_total_revenue: Math.round(paid.reduce((s, o) => s + netTotal(o), 0) * 100) / 100,
    first_order_date: dates[0] ?? null,
    last_order_date: dates.at(-1) ?? null,
  };
}
