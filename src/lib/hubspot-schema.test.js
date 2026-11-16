import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROPERTY_GROUP, PROPERTIES, DEAL_PIPELINE, TICKET_PIPELINE } from './hubspot-schema.js';

const names = (object) => PROPERTIES[object].map((p) => p.name);
const prop = (object, name) => PROPERTIES[object].find((p) => p.name === name);

test('every object property lives in the woocommerce group', () => {
  assert.equal(PROPERTY_GROUP.name, 'woocommerce');
  for (const list of Object.values(PROPERTIES)) for (const p of list) assert.equal(p.groupName, 'woocommerce', p.name);
});

test('contact properties match the spec', () => {
  assert.deepEqual(names('contacts').sort(), [
    'customer_segment', 'data_quality_issues', 'data_quality_status', 'first_order_date', 'last_order_date',
    'total_orders', 'woo_customer_id', 'woo_total_revenue',
  ]);
  assert.equal(prop('contacts', 'woo_total_revenue').type, 'number');
  assert.equal(prop('contacts', 'first_order_date').type, 'date');
  assert.deepEqual(prop('contacts', 'customer_segment').options.map((o) => o.value), ['new', 'repeat', 'vip']);
  assert.deepEqual(prop('contacts', 'data_quality_status').options.map((o) => o.value), ['ok', 'needs_review']);
});

test('deal, product and line item properties match the spec', () => {
  assert.deepEqual(names('deals').sort(), ['refund_amount', 'woo_order_id', 'woo_status']);
  assert.deepEqual(names('products'), ['woo_product_id']);
  assert.deepEqual(names('line_items'), ['woo_line_item_id']);
  assert.deepEqual(names('tickets'), ['sync_error_key']);
});

test('unique flags only where HubSpot supports them (not products; line items unconfirmed)', () => {
  const unique = Object.entries(PROPERTIES).flatMap(([o, list]) => list.filter((p) => p.hasUniqueValue).map((p) => `${o}.${p.name}`));
  assert.deepEqual(unique.sort(), ['deals.woo_order_id', 'tickets.sync_error_key']);
});

test('deal pipeline has the 5 spec stages with internal keys and closed probabilities', () => {
  assert.equal(DEAL_PIPELINE.label, 'WooCommerce');
  assert.deepEqual(DEAL_PIPELINE.stages.map((s) => [s.key, s.label, s.metadata.probability]), [
    ['pending_payment', 'Pending payment', '0.2'],
    ['paid', 'Paid', '0.9'],
    ['closedwon', 'Closed won', '1.0'],
    ['closedlost', 'Closed lost', '0.0'],
    ['refunded', 'Refunded', '0.0'],
  ]);
});

test('ticket pipeline for integration errors has an open and a closed stage', () => {
  assert.equal(TICKET_PIPELINE.label, 'Integration errors');
  assert.deepEqual(TICKET_PIPELINE.stages.map((s) => [s.key, s.metadata.ticketState]), [['new', 'OPEN'], ['resolved', 'CLOSED']]);
});

test('no property name collides with a HubSpot default property the sync cannot write', () => {
  // total_revenue is a read-only HubSpot default on contacts (found against the real API, 2026-11-16).
  const reserved = { contacts: ['total_revenue', 'email', 'lifecyclestage'], deals: ['amount', 'dealstage'] };
  for (const [object, names] of Object.entries(reserved)) {
    for (const name of names) assert.equal(prop(object, name), undefined, `${object}.${name}`);
  }
});
