import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STAGE_BY_STATUS, companyDomain, planCompanies, buildContactInput, buildProductInputs,
  buildDealInput, buildLineItemInputs, aggregateCustomer,
} from './mapping.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const completed = fixture('order-completed-company');
const partial = fixture('order-guest-partial-refund');
const refunded = fixture('order-refunded');

const ctx = {
  pipelineId: 'p1',
  stageIds: { pending_payment: 's-pend', paid: 's-paid', closedwon: 's-won', closedlost: 's-lost', refunded: 's-ref' },
};

test('STAGE_BY_STATUS maps every Woo status to the spec stage', () => {
  assert.deepEqual(STAGE_BY_STATUS, {
    pending: 'pending_payment', 'on-hold': 'pending_payment', processing: 'paid', completed: 'closedwon',
    cancelled: 'closedlost', failed: 'closedlost', refunded: 'refunded',
  });
});

test('companyDomain returns business domains only', () => {
  assert.equal(companyDomain('a@acme.io'), 'acme.io');
  assert.equal(companyDomain('A@Sub.Acme.IO '), 'sub.acme.io');
  assert.equal(companyDomain('a@gmail.com'), null);
  assert.equal(companyDomain('a@hotmail.com'), null);
  assert.equal(companyDomain('garbage'), null);
});

test('planCompanies dedupes by domain within a batch and skips free/invalid emails', () => {
  const plan = planCompanies([completed, refunded, partial]);
  assert.deepEqual(plan, [{ domain: 'acme-andina.test', name: 'Acme Andina SRL' }]);
});

test('planCompanies falls back to the domain as name when billing company is empty', () => {
  const o = { ...completed, billing: { ...completed.billing, company: '', email: 'x@globex.test' } };
  assert.deepEqual(planCompanies([o]), [{ domain: 'globex.test', name: 'globex.test' }]);
});

test('buildContactInput maps clean billing data and marks quality ok', () => {
  const c = buildContactInput(completed);
  assert.equal(c.email, 'ana@acme-andina.test');
  assert.deepEqual(c.properties, {
    email: 'ana@acme-andina.test', firstname: 'Ana', lastname: 'Pérez', phone: '+541144445555',
    country: 'AR', company: 'Acme Andina SRL', woo_customer_id: '7',
    data_quality_status: 'ok', data_quality_issues: '',
  });
  assert.deepEqual(c.issues, []);
});

test('buildContactInput with a typo email has no email and lists issues', () => {
  const c = buildContactInput(partial);
  assert.equal(c.email, null);
  assert.ok(c.issues.some((i) => i.startsWith('email_typo_domain')));
  assert.ok(c.issues.includes('phone_invalid'));
  assert.equal(c.properties.data_quality_status, 'needs_review');
  assert.equal(c.properties.country, 'AR');
  assert.equal(c.properties.phone, undefined, 'invalid fields are omitted, not sent as null');
  assert.equal(c.properties.woo_customer_id, undefined, 'guests have no Woo customer id');
});

test('buildProductInputs returns one upsert input per Woo product across orders', () => {
  const p = buildProductInputs([completed, completed, refunded]);
  assert.equal(p.length, 3);
  assert.deepEqual(p[0], {
    idProperty: 'woo_product_id', id: '11',
    properties: { woo_product_id: '11', name: 'Organic Cotton Tee', price: '24.00', hs_sku: 'DEMO-TEE-01' },
  });
});

test('buildDealInput maps a completed order', () => {
  const d = buildDealInput(completed, ctx);
  assert.deepEqual(d, {
    idProperty: 'woo_order_id', id: '101',
    properties: {
      woo_order_id: '101', dealname: 'Woo #101 — Ana Pérez', pipeline: 'p1', dealstage: 's-won',
      amount: '148.00', refund_amount: '0.00', closedate: '2026-03-04T15:20:00.000Z',
      woo_status: 'completed', deal_currency_code: 'USD',
    },
  });
});

test('buildDealInput is deterministic (same order twice → same input)', () => {
  assert.deepEqual(buildDealInput(completed, ctx), buildDealInput(structuredClone(completed), ctx));
});

test('buildDealInput: partial refund on completed stays won with net amount', () => {
  const d = buildDealInput(partial, ctx).properties;
  assert.equal(d.dealstage, 's-won');
  assert.equal(d.amount, '69.00');
  assert.equal(d.refund_amount, '20.00');
});

test('buildDealInput: fully refunded order goes to Refunded with amount 0', () => {
  const d = buildDealInput(refunded, ctx).properties;
  assert.equal(d.dealstage, 's-ref');
  assert.equal(d.amount, '0.00');
  assert.equal(d.refund_amount, '59.00');
});

test('buildDealInput throws on an unknown status instead of guessing a stage', () => {
  assert.throws(() => buildDealInput({ ...completed, status: 'checkout-draft' }, ctx), /Unknown Woo status/);
});

test('buildLineItemInputs returns one stable upsert input per order item', () => {
  const li = buildLineItemInputs(completed);
  assert.equal(li.length, 2);
  assert.deepEqual(li[0], {
    idProperty: 'woo_line_item_key', id: '501', wooProductId: '11',
    properties: { woo_line_item_key: '501', name: 'Organic Cotton Tee', quantity: '2', price: '24.00', hs_sku: 'DEMO-TEE-01' },
  });
});

test('aggregateCustomer counts paid orders and nets refunds', () => {
  const o = (id, status, total, refund, date) => ({
    id, status, total, date_created_gmt: date, refunds: refund ? [{ total: `-${refund}` }] : [],
  });
  const agg = aggregateCustomer([
    o(1, 'completed', '100.00', 0, '2026-01-10T10:00:00'),
    o(2, 'processing', '50.00', '20.00', '2026-04-02T10:00:00'),
    o(3, 'cancelled', '999.00', 0, '2026-08-01T10:00:00'),
    o(4, 'refunded', '30.00', '30.00', '2026-09-01T10:00:00'),
  ]);
  assert.deepEqual(agg, {
    total_orders: 2, woo_total_revenue: 130, first_order_date: '2026-01-10', last_order_date: '2026-04-02',
  });
});

test('aggregateCustomer with no paid orders returns zeros and null dates', () => {
  assert.deepEqual(aggregateCustomer([{ id: 1, status: 'failed', total: '10.00', refunds: [], date_created_gmt: '2026-01-01T00:00:00' }]), {
    total_orders: 0, woo_total_revenue: 0, first_order_date: null, last_order_date: null,
  });
});
