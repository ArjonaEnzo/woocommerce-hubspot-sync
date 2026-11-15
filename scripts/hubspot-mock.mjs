#!/usr/bin/env node
// Minimal in-memory stand-in for the HubSpot CRM endpoints this sync uses.
// It is NOT HubSpot: it exists to test the n8n flows offline and to inject 429/5xx.
// Run: node scripts/hubspot-mock.mjs   (PORT env, default 4010)
import { createServer } from 'node:http';
import { DEAL_PIPELINE, TICKET_PIPELINE } from '../src/lib/hubspot-schema.js';

const UNIQUE_ID_PROPS = {
  contacts: ['email'], companies: [], deals: ['woo_order_id'], products: ['woo_product_id'],
  line_items: ['woo_line_item_id'], tickets: ['sync_error_key'],
};

const pipelineOf = (objectType, def) => ({
  id: `mock-${objectType}-pipeline`,
  label: def.label,
  stages: def.stages.map((s) => ({ id: `mock-stage-${s.key}`, label: s.label, metadata: s.metadata })),
});

export function createMockHubSpot() {
  let nextId = 1000;
  const store = Object.fromEntries(Object.keys(UNIQUE_ID_PROPS).map((t) => [t, new Map()]));
  const associations = new Set();
  const failures = { status: 0, times: 0 };
  const requests = [];
  const pipelines = { deals: [pipelineOf('deals', DEAL_PIPELINE)], tickets: [pipelineOf('tickets', TICKET_PIPELINE)] };

  const create = (type, properties) => {
    const record = { id: String(nextId++), properties: { ...properties } };
    store[type].set(record.id, record);
    return record;
  };
  const findBy = (type, prop, value) =>
    [...store[type].values()].find((r) => String(r.properties[prop] ?? '').toLowerCase() === String(value).toLowerCase());

  const routes = [
    ['GET', /^\/crm\/v3\/pipelines\/(deals|tickets)$/, (m) => [200, { results: pipelines[m[1]] }]],

    ['POST', /^\/crm\/v3\/objects\/(\w+)\/batch\/upsert$/, (m, body) => {
      const type = m[1];
      if (!store[type]) return [404, { message: `unknown object ${type}` }];
      if (!Array.isArray(body?.inputs) || body.inputs.length > 100) return [400, { message: 'inputs must be 1..100' }];
      const results = body.inputs.map(({ idProperty, id, properties }) => {
        if (!UNIQUE_ID_PROPS[type].includes(idProperty)) throw Object.assign(new Error(`${idProperty} is not unique`), { status: 400 });
        const existing = findBy(type, idProperty, id);
        if (existing) {
          Object.assign(existing.properties, properties, { [idProperty]: String(id) });
          return { ...existing, new: false };
        }
        return { ...create(type, { ...properties, [idProperty]: String(id) }), new: true };
      });
      return [200, { status: 'COMPLETE', results }];
    }],

    ['POST', /^\/crm\/v3\/objects\/(\w+)\/batch\/create$/, (m, body) => {
      if (!store[m[1]]) return [404, { message: `unknown object ${m[1]}` }];
      if (!Array.isArray(body?.inputs) || body.inputs.length > 100) return [400, { message: 'inputs must be 1..100' }];
      return [201, { status: 'COMPLETE', results: body.inputs.map((i) => create(m[1], i.properties)) }];
    }],

    ['POST', /^\/crm\/v3\/objects\/(\w+)\/search$/, (m, body) => {
      const filters = body?.filterGroups?.[0]?.filters ?? [];
      const results = [...store[m[1]].values()].filter((r) => filters.every((f) => {
        const v = String(r.properties[f.propertyName] ?? '').toLowerCase();
        if (f.operator === 'IN') return f.values.map((x) => String(x).toLowerCase()).includes(v);
        if (f.operator === 'EQ') return v === String(f.value).toLowerCase();
        return false;
      }));
      return [200, { total: results.length, results: results.slice(0, body?.limit ?? 10) }];
    }],

    ['POST', /^\/crm\/v4\/associations\/(\w+)\/(\w+)\/batch\/associate\/default$/, (m, body) => {
      if (!Array.isArray(body?.inputs) || body.inputs.length > 2000) return [400, { message: 'inputs must be 1..2000' }];
      for (const { from, to } of body.inputs) associations.add(`${m[1]}:${from.id}->${m[2]}:${to.id}`);
      return [200, { status: 'COMPLETE', results: body.inputs }];
    }],

    // Test helpers (not HubSpot API)
    ['GET', /^\/__state$/, () => [200, {
      counts: { ...Object.fromEntries(Object.entries(store).map(([t, s]) => [t, s.size])), associations: associations.size },
      records: Object.fromEntries(Object.entries(store).map(([t, s]) => [t, [...s.values()]])),
      associations: [...associations],
      requests,
    }]],
    ['POST', /^\/__fail$/, (_m, body) => {
      failures.status = body.status;
      failures.times = body.times;
      return [200, { ok: true }];
    }],
    ['POST', /^\/__reset$/, () => {
      for (const s of Object.values(store)) s.clear();
      associations.clear();
      requests.length = 0;
      return [200, { ok: true }];
    }],
  ];

  return createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://mock');
    const isHelper = url.pathname.startsWith('/__');

    if (!isHelper) {
      requests.push({ method: req.method, path: url.pathname, body: raw.slice(0, 300) });
      if (!/^Bearer \S+/.test(req.headers.authorization ?? '')) return send(401, { message: 'missing bearer token' });
      if (failures.times > 0) {
        failures.times--;
        return send(failures.status, { status: 'error', message: `injected ${failures.status}` });
      }
    }
    const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
    if (!route) return send(404, { message: `mock: no route for ${req.method} ${url.pathname}` });
    try {
      const [status, payload] = route[2](url.pathname.match(route[1]), raw ? JSON.parse(raw) : null);
      return send(status, payload);
    } catch (err) {
      return send(err.status ?? 500, { message: err.message });
    }
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 4010);
  createMockHubSpot().listen(port, () => console.log(`HubSpot mock on :${port}`));
}
