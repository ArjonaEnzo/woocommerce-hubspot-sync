import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyReport } from './verify.js';

const deal = (id, stage, amount) => ({ id: `h${id}`, properties: { woo_order_id: String(id), dealstage: stage, amount } });
const stageIds = { closedwon: 'won', refunded: 'ref' };

test('verifyReport counts deals, duplicates and closed-won revenue', () => {
  const r = verifyReport({
    wooOrders: 3,
    deals: [deal(1, 'won', '100.00'), deal(2, 'won', '50.50'), deal(3, 'ref', '0.00')],
    stageIds, contacts: 2, companies: 1, needsReview: 1, tickets: 1,
  });
  assert.equal(r.deals_in_hubspot, 3);
  assert.equal(r.duplicate_woo_order_ids, 0);
  assert.equal(r.closed_won_revenue, 150.5);
  assert.equal(r.closed_won_deals, 2);
  assert.equal(r.average_order_value, 75.25);
  assert.deepEqual(r.problems, []);
});

test('verifyReport flags duplicates and missing orders', () => {
  const r = verifyReport({
    wooOrders: 3, deals: [deal(1, 'won', '1'), deal(1, 'won', '1')], stageIds,
    contacts: 0, companies: 0, needsReview: 0, tickets: 0,
  });
  assert.equal(r.duplicate_woo_order_ids, 1);
  assert.deepEqual(r.problems, ['1 duplicate woo_order_id', 'Woo has 3 orders but HubSpot has 1 distinct deals']);
});
