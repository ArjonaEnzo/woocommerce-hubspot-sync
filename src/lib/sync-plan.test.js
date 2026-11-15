import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  pipelineContext, contactRequests, companySearchRequest, companyCreateRequest, productRequests,
  dealRequests, lineItemRequests, idMap, associationRequests, ticketReadRequest, ticketCreateRequest,
  syncProblems,
} from './sync-plan.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const completed = fixture('order-completed-company'); // ana@acme-andina.test, items 501/502
const partial = fixture('order-guest-partial-refund'); // juan@gmial.con (invalid)
const refunded = fixture('order-refunded'); // lucia@acme-andina.test
const orders = [completed, partial, refunded];

const dealPipelines = { results: [
  { id: 'default', label: 'Sales Pipeline', stages: [] },
  { id: 'p1', label: 'WooCommerce', stages: [
    { id: 's1', label: 'Pending payment' }, { id: 's2', label: 'Paid' }, { id: 's3', label: 'Closed won' },
    { id: 's4', label: 'Closed lost' }, { id: 's5', label: 'Refunded' }] },
] };
const ticketPipelines = { results: [{ id: 't1', label: 'Integration errors', stages: [{ id: 'tn', label: 'New' }, { id: 'tr', label: 'Resolved' }] }] };
const ctx = pipelineContext(dealPipelines, ticketPipelines);
const ok = (results, status = 200) => ({ ok: true, status, body: { status: 'COMPLETE', results } });

test('pipelineContext maps stage labels to ids', () => {
  assert.deepEqual(ctx, {
    pipelineId: 'p1',
    stageIds: { pending_payment: 's1', paid: 's2', closedwon: 's3', closedlost: 's4', refunded: 's5' },
    ticketPipelineId: 't1', ticketStageNewId: 'tn',
  });
});

test('pipelineContext fails with a setup hint when the pipeline is missing', () => {
  assert.throws(() => pipelineContext({ results: [] }, ticketPipelines), /hubspot-setup/);
});

test('contactRequests upserts valid emails once each, with aggregates from history', () => {
  const second = { ...completed, id: 104, date_created_gmt: '2026-07-01T10:00:00', total: '50.00' };
  const [req] = contactRequests([completed, second, partial], [completed, second, partial]);
  assert.equal(req.path, '/crm/v3/objects/contacts/batch/upsert');
  assert.equal(req.body.inputs.length, 1, 'invalid email skipped, duplicate email merged');
  const input = req.body.inputs[0];
  assert.equal(input.idProperty, 'email');
  assert.equal(input.id, 'ana@acme-andina.test');
  assert.equal(input.properties.total_orders, 2);
  assert.equal(input.properties.total_revenue, 198);
  assert.equal(input.properties.first_order_date, '2026-03-04');
  assert.equal(input.properties.last_order_date, '2026-07-01');
});

test('contactRequests returns a skip request when no order has a valid email', () => {
  assert.deepEqual(contactRequests([partial], [partial]), [{ skip: true, label: 'contacts' }]);
});

test('companySearchRequest searches all business domains in one call', () => {
  const r = companySearchRequest(orders);
  assert.equal(r.path, '/crm/v3/objects/companies/search');
  assert.deepEqual(r.body.filterGroups[0].filters[0], { propertyName: 'domain', operator: 'IN', values: ['acme-andina.test'] });
  assert.deepEqual(companySearchRequest([partial]), { skip: true, label: 'company search' });
});

test('companyCreateRequest creates only companies the search did not find', () => {
  const found = ok([{ id: 'c9', properties: { domain: 'acme-andina.test' } }]);
  assert.deepEqual(companyCreateRequest(orders, found), { skip: true, label: 'company create' });
  const r = companyCreateRequest(orders, ok([]));
  assert.deepEqual(r.body.inputs, [{ properties: { domain: 'acme-andina.test', name: 'Acme Andina SRL' } }]);
});

test('productRequests and lineItemRequests chunk at 100 inputs', () => {
  const many = Array.from({ length: 150 }, (_, i) => ({ ...completed, id: 1000 + i,
    line_items: [{ id: 5000 + i, name: `P${i}`, product_id: 2000 + i, quantity: 1, price: 1, sku: '' }] }));
  assert.deepEqual(productRequests(many).map((r) => r.body.inputs.length), [100, 50]);
  const ids = new Map(many.map((o) => [String(o.line_items[0].product_id), `hs-${o.id}`]));
  const li = lineItemRequests(many, ids);
  assert.deepEqual(li.map((r) => r.body.inputs.length), [100, 50]);
  assert.equal(li[0].body.inputs[0].properties.hs_product_id, 'hs-1000');
  assert.equal(li[0].body.inputs[0].wooProductId, undefined, 'internal fields are not sent to HubSpot');
});

test('dealRequests upserts known statuses and reports unknown ones as problems', () => {
  const weird = { ...completed, id: 999, status: 'checkout-draft' };
  const { requests, problems } = dealRequests([completed, weird], ctx);
  assert.deepEqual(requests[0].body.inputs.map((i) => i.id), ['101']);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].key, 'unknown-status:999');
});

test('idMap reads ids from batch responses by a property', () => {
  const m = idMap([ok([{ id: 'h1', properties: { woo_order_id: '101' } }]), { ok: true, skipped: true, body: null }], 'woo_order_id');
  assert.deepEqual([...m], [['101', 'h1']]);
});

test('associationRequests links contact↔company, deal↔contact, deal↔company, line item↔deal', () => {
  const reqs = associationRequests({
    orders,
    contactIds: new Map([['ana@acme-andina.test', 'k1'], ['lucia@acme-andina.test', 'k2']]),
    companyIds: new Map([['acme-andina.test', 'c1']]),
    dealIds: new Map([['101', 'd1'], ['102', 'd2'], ['103', 'd3']]),
    lineItemIds: new Map([['501', 'l1'], ['502', 'l2'], ['503', 'l3'], ['504', 'l4']]),
  });
  const byPath = Object.fromEntries(reqs.map((r) => [r.path, r.body.inputs.map((i) => `${i.from.id}>${i.to.id}`)]));
  assert.deepEqual(byPath['/crm/v4/associations/contacts/companies/batch/associate/default'], ['k1>c1', 'k2>c1']);
  assert.deepEqual(byPath['/crm/v4/associations/deals/contacts/batch/associate/default'], ['d1>k1', 'd3>k2']);
  assert.deepEqual(byPath['/crm/v4/associations/deals/companies/batch/associate/default'], ['d1>c1', 'd3>c1']);
  assert.deepEqual(byPath['/crm/v4/associations/line_items/deals/batch/associate/default'], ['l1>d1', 'l2>d1', 'l3>d2', 'l4>d3']);
});

test('syncProblems reports orders without a valid email and batch errors, with stable keys', () => {
  const batch = { ok: true, status: 207, label: 'deals', body: { results: [], errors: [
    { status: 'error', category: 'VALIDATION_ERROR', message: 'Property "foo" does not exist', context: { ids: ['105'] } },
  ] } };
  const problems = syncProblems(orders, [batch]);
  assert.deepEqual(problems.map((p) => p.key), ['no-contact:102', 'batch:deals:105']);
  assert.match(problems[0].subject, /#102/);
  assert.match(problems[0].content, /email_typo_domain/);
});

test('ticketCreateRequest creates tickets only for problems not already open', () => {
  const problems = syncProblems(orders, []);
  assert.deepEqual(ticketReadRequest(problems).body, { idProperty: 'sync_error_key', inputs: [{ id: 'no-contact:102' }], properties: ['sync_error_key'] });
  const existing = ok([{ id: 't9', properties: { sync_error_key: 'no-contact:102' } }]);
  assert.deepEqual(ticketCreateRequest(problems, existing, ctx), { skip: true, label: 'tickets' });
  const r = ticketCreateRequest(problems, ok([]), ctx);
  assert.equal(r.path, '/crm/v3/objects/tickets/batch/create');
  assert.deepEqual(Object.keys(r.body.inputs[0].properties).sort(),
    ['content', 'hs_pipeline', 'hs_pipeline_stage', 'hs_ticket_priority', 'subject', 'sync_error_key']);
  assert.deepEqual(ticketReadRequest([]), { skip: true, label: 'ticket lookup' });
});
