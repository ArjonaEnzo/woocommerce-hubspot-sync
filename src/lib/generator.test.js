import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateOrders } from './generator.js';
import { validateCustomer } from './validate.js';
import { companyDomain } from './mapping.js';

const catalog = JSON.parse(readFileSync(new URL('../../data/catalog.json', import.meta.url)));
const now = new Date('2026-11-15T12:00:00Z');
const orders = generateOrders({ seed: 42, count: 200, catalog, now });

const countBy = (arr, fn) => arr.reduce((m, x) => ((m[fn(x)] = (m[fn(x)] ?? 0) + 1), m), {});
const PAID = new Set(['processing', 'completed']);

test('same seed produces identical output', () => {
  assert.deepEqual(generateOrders({ seed: 42, count: 200, catalog, now }), orders);
  assert.notDeepEqual(generateOrders({ seed: 7, count: 200, catalog, now }), orders);
});

test('produces exactly count orders with unique generator ids', () => {
  assert.equal(orders.length, 200);
  assert.equal(new Set(orders.map((o) => o.gen_id)).size, 200);
});

test('status mix is exact', () => {
  const s = countBy(orders, (o) => o.status);
  assert.equal(s.completed, 110);
  assert.equal(s.processing, 40);
  assert.equal((s.pending ?? 0) + (s['on-hold'] ?? 0), 15);
  assert.equal((s.cancelled ?? 0) + (s.failed ?? 0), 20);
  assert.equal(s.refunded, 15);
});

test('10 completed orders have a partial refund; refunded orders refund the full total', () => {
  const partial = orders.filter((o) => o.status === 'completed' && o.refund_amount > 0);
  assert.equal(partial.length, 10);
  for (const o of partial) assert.ok(o.refund_amount < o.total);
  for (const o of orders.filter((x) => x.status === 'refunded')) assert.equal(o.refund_amount, o.total);
});

test('totals equal the sum of catalog price × quantity', () => {
  const price = Object.fromEntries(catalog.map((p) => [p.sku, p.price]));
  for (const o of orders) {
    const sum = o.items.reduce((s, i) => s + price[i.sku] * i.quantity, 0);
    assert.equal(o.total, Math.round(sum * 100) / 100);
    assert.ok(o.items.length >= 1 && o.items.every((i) => i.quantity >= 1));
  }
});

test('between 100 and 140 unique customers, so repeat buyers exist', () => {
  const n = new Set(orders.map((o) => o.customer.email)).size;
  assert.ok(n >= 100 && n <= 140, `unique customers: ${n}`);
});

test('at least 5 VIP customers (paid net revenue > 1000)', () => {
  const rev = {};
  for (const o of orders.filter((x) => PAID.has(x.status))) {
    rev[o.customer.email] = (rev[o.customer.email] ?? 0) + o.total - o.refund_amount;
  }
  assert.ok(Object.values(rev).filter((r) => r > 1000).length >= 5);
});

test('at least 15 orders carry dirty data the validator catches, all with format-valid emails', () => {
  const dirty = orders.filter((o) => validateCustomer(o.customer).issues.length > 0);
  assert.ok(dirty.length >= 15, `dirty orders: ${dirty.length}`);
  for (const o of orders) assert.match(o.customer.email, /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/);
});

test('about a quarter of customers belong to a company; some companies share a domain', () => {
  const customers = new Map(orders.map((o) => [o.customer.email, o.customer]));
  const withDomain = [...customers.values()].filter((c) => companyDomain(c.email));
  const ratio = withDomain.length / customers.size;
  assert.ok(ratio >= 0.18 && ratio <= 0.35, `company ratio ${ratio}`);
  const perDomain = countBy(withDomain, (c) => companyDomain(c.email));
  assert.ok(Object.values(perDomain).some((n) => n >= 3));
  // .test is reserved but HubSpot rejects it (INVALID_EMAIL); subdomains of IANA-reserved example.com pass.
  for (const d of Object.keys(perDomain)) assert.match(d, /\.example\.com$/, 'company domains are subdomains of example.com');
});

test('dates span the 12 months before now', () => {
  const ts = orders.map((o) => Date.parse(o.date_created));
  const yearAgo = now.getTime() - 365 * 864e5;
  assert.ok(Math.min(...ts) >= yearAgo && Math.max(...ts) <= now.getTime());
  const months = new Set(orders.map((o) => o.date_created.slice(0, 7)));
  assert.ok(months.size >= 12, `months covered: ${months.size}`);
});
