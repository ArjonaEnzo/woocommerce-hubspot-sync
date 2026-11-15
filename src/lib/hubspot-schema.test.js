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
    'total_orders', 'total_revenue', 'woo_customer_id',
  ]);
  assert.equal(prop('contacts', 'total_revenue').type, 'number');
  assert.equal(prop('contacts', 'first_order_date').type, 'date');
  assert.deepEqual(prop('contacts', 'customer_segment').options.map((o) => o.value), ['new', 'repeat', 'vip']);
  assert.deepEqual(prop('contacts', 'data_quality_status').options.map((o) => o.value), ['ok', 'needs_review']);
});

test('deal, product and line item properties match the spec', () => {
  assert.deepEqual(names('deals').sort(), ['last_sync_error_at', 'refund_amount', 'woo_order_id', 'woo_status']);
  assert.deepEqual(names('products'), ['woo_product_id']);
  assert.deepEqual(names('line_items'), ['woo_line_item_id']);
  assert.equal(prop('deals', 'last_sync_error_at').type, 'datetime');
});

test('only the three idempotency keys are unique', () => {
  const unique = Object.entries(PROPERTIES).flatMap(([o, list]) => list.filter((p) => p.hasUniqueValue).map((p) => `${o}.${p.name}`));
  assert.deepEqual(unique.sort(), ['deals.woo_order_id', 'line_items.woo_line_item_id', 'products.woo_product_id']);
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
