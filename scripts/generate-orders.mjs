#!/usr/bin/env node
// Writes data/orders.json from data/catalog.json. Deterministic for a given --seed/--count/--now.
// Usage: node scripts/generate-orders.mjs --seed 42 --count 200 [--now 2026-11-15T12:00:00Z]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { generateOrders } from '../src/lib/generator.js';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '42' },
    count: { type: 'string', default: '200' },
    now: { type: 'string', default: '2026-11-15T12:00:00Z' },
  },
});

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('data/catalog.json', root)));
const orders = generateOrders({
  seed: Number(values.seed), count: Number(values.count), catalog, now: new Date(values.now),
});
writeFileSync(new URL('data/orders.json', root), `${JSON.stringify(orders, null, 1)}\n`);

const by = (k) => orders.reduce((m, o) => ((m[o[k]] = (m[o[k]] ?? 0) + 1), m), {});
console.log(`Wrote ${orders.length} orders, ${new Set(orders.map((o) => o.customer.email)).size} customers`);
console.log('By status:', by('status'));
