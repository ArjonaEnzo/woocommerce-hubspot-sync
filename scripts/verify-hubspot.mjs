#!/usr/bin/env node
// Compares WooCommerce with HubSpot and prints the numbers quoted in the README and case study.
// Exit code 1 if there are duplicate deals or Woo orders without a deal.
// Uses VERIFY_HUBSPOT_URL (default https://api.hubapi.com; http://localhost:4010 for the mock).
import { existsSync } from 'node:fs';
import { pipelineContext } from '../src/lib/sync-plan.js';
import { verifyReport } from '../src/lib/verify.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { WP_ADMIN_USER, WOO_APP_PASSWORD } = process.env;
const token = process.env.HUBSPOT_SERVICE_KEY || 'mock-token-not-a-secret';
const base = (process.env.VERIFY_HUBSPOT_URL || 'https://api.hubapi.com').replace(/\/$/, '');

async function hubspot(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function search(objectType, filters, properties = []) {
  const results = [];
  let after;
  do {
    const page = await hubspot('POST', `/crm/v3/objects/${objectType}/search`, {
      filterGroups: filters.length ? [{ filters }] : [],
      properties,
      limit: 100,
      ...(after ? { after } : {}),
    });
    results.push(...page.results);
    after = page.paging?.next?.after;
  } while (after);
  return results;
}

const count = async (objectType, filters = []) =>
  (await hubspot('POST', `/crm/v3/objects/${objectType}/search`, {
    filterGroups: filters.length ? [{ filters }] : [], limit: 1,
  })).total;

const wooRes = await fetch('http://localhost:8080/wp-json/wc/v3/orders?per_page=1', {
  headers: { authorization: `Basic ${Buffer.from(`${WP_ADMIN_USER}:${WOO_APP_PASSWORD}`).toString('base64')}` },
});
const wooOrders = Number(wooRes.headers.get('x-wp-total'));

const ctx = pipelineContext(await hubspot('GET', '/crm/v3/pipelines/deals'), await hubspot('GET', '/crm/v3/pipelines/tickets'));
const eq = (propertyName, value) => ({ propertyName, operator: 'EQ', value });

const report = verifyReport({
  wooOrders,
  deals: await search('deals', [eq('pipeline', ctx.pipelineId)], ['woo_order_id', 'dealstage', 'amount']),
  stageIds: ctx.stageIds,
  contacts: await count('contacts'),
  companies: await count('companies'),
  needsReview: await count('contacts', [eq('data_quality_status', 'needs_review')]),
  tickets: await count('tickets', [eq('hs_pipeline', ctx.ticketPipelineId)]),
  keys: {
    companies: (await search('companies', [{ propertyName: 'domain', operator: 'HAS_PROPERTY' }], ['domain'])).map((c) => c.properties.domain),
    products: (await search('products', [{ propertyName: 'woo_product_id', operator: 'HAS_PROPERTY' }], ['woo_product_id'])).map((p) => p.properties.woo_product_id),
    line_items: (await search('line_items', [{ propertyName: 'woo_line_item_key', operator: 'HAS_PROPERTY' }], ['woo_line_item_key'])).map((l) => l.properties.woo_line_item_key),
  },
});

console.log(JSON.stringify({ hubspot: base, ...report }, null, 2));
process.exit(report.problems.length ? 1 : 0);
