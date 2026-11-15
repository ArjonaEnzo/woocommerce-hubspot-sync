import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockHubSpot } from './hubspot-mock.mjs';

let server;
let base;
before(async () => {
  server = createMockHubSpot();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, path, body, auth = true) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer test' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
};

test('rejects requests without a bearer token', async () => {
  assert.equal((await call('GET', '/crm/v3/pipelines/deals', null, false)).status, 401);
});

test('serves the WooCommerce deal pipeline with the 5 stages', async () => {
  const r = await call('GET', '/crm/v3/pipelines/deals');
  const p = r.body.results.find((x) => x.label === 'WooCommerce');
  assert.deepEqual(p.stages.map((s) => s.label), ['Pending payment', 'Paid', 'Closed won', 'Closed lost', 'Refunded']);
});

test('batch upsert is idempotent by the unique id property', async () => {
  const input = { idProperty: 'woo_order_id', id: '101', properties: { woo_order_id: '101', amount: '10.00' } };
  const first = await call('POST', '/crm/v3/objects/deals/batch/upsert', { inputs: [input] });
  const second = await call('POST', '/crm/v3/objects/deals/batch/upsert', {
    inputs: [{ ...input, properties: { ...input.properties, amount: '5.00' } }],
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.results[0].id, second.body.results[0].id);
  assert.equal(second.body.results[0].properties.amount, '5.00');
  assert.equal((await call('GET', '/__state')).body.counts.deals, 1);
});

test('batch upsert rejects more than 100 inputs', async () => {
  const inputs = Array.from({ length: 101 }, (_, i) => ({ idProperty: 'email', id: `a${i}@x.test`, properties: {} }));
  assert.equal((await call('POST', '/crm/v3/objects/contacts/batch/upsert', { inputs })).status, 400);
});

test('company search by domain IN finds created companies', async () => {
  await call('POST', '/crm/v3/objects/companies/batch/create', { inputs: [{ properties: { domain: 'acme.test', name: 'Acme' } }] });
  const r = await call('POST', '/crm/v3/objects/companies/search', {
    filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'IN', values: ['acme.test', 'nope.test'] }] }],
    properties: ['domain'], limit: 100,
  });
  assert.deepEqual(r.body.results.map((c) => c.properties.domain), ['acme.test']);
});

test('default associations are stored once per pair', async () => {
  const body = { inputs: [{ from: { id: '1' }, to: { id: '2' } }] };
  await call('POST', '/crm/v4/associations/deals/contacts/batch/associate/default', body);
  await call('POST', '/crm/v4/associations/deals/contacts/batch/associate/default', body);
  assert.equal((await call('GET', '/__state')).body.counts.associations, 1);
});

test('failure injection returns the status N times, then recovers', async () => {
  await call('POST', '/__fail', { status: 429, times: 2 });
  assert.equal((await call('GET', '/crm/v3/pipelines/deals')).status, 429);
  assert.equal((await call('GET', '/crm/v3/pipelines/deals')).status, 429);
  assert.equal((await call('GET', '/crm/v3/pipelines/deals')).status, 200);
});
