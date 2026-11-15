// Turns a batch of Woo orders into the ordered list of HubSpot requests the sync-orders workflow makes.
// Every function returns plain request objects { method, path, body, label } — or { skip: true, label }
// when there is nothing to send — so the n8n flow stays linear and every step is unit-tested here.
import { DEAL_PIPELINE, TICKET_PIPELINE } from './hubspot-schema.js';
import { chunk } from './retry.js';
import {
  buildContactInput, planCompanies, companyDomain, buildProductInputs, buildDealInput, buildLineItemInputs,
  aggregateCustomer,
} from './mapping.js';

const BATCH = 100;
const skip = (label) => ({ skip: true, label });
const post = (path, body, label) => ({ method: 'POST', path, body, label });
const batches = (path, inputs, label) =>
  (inputs.length ? chunk(inputs, BATCH).map((part, i) => post(path, { inputs: part }, `${label} ${i + 1}`)) : [skip(label)]);
const lower = (s) => String(s ?? '').trim().toLowerCase();

export function pipelineContext(dealPipelines, ticketPipelines) {
  const find = (list, def) => {
    const p = (list?.results ?? []).find((x) => x.label === def.label);
    if (!p) throw new Error(`HubSpot pipeline "${def.label}" not found — run scripts/hubspot-setup.mjs first`);
    const ids = {};
    for (const s of def.stages) {
      const stage = p.stages.find((x) => x.label === s.label);
      if (!stage) throw new Error(`Stage "${s.label}" missing in pipeline "${def.label}" — run scripts/hubspot-setup.mjs`);
      ids[s.key] = stage.id;
    }
    return { id: p.id, ids };
  };
  const deals = find(dealPipelines, DEAL_PIPELINE);
  const tickets = find(ticketPipelines, TICKET_PIPELINE);
  return { pipelineId: deals.id, stageIds: deals.ids, ticketPipelineId: tickets.id, ticketStageNewId: tickets.ids.new };
}

export function contactRequests(orders, history) {
  const byEmail = new Map();
  for (const order of orders) {
    const contact = buildContactInput(order);
    if (contact.email) byEmail.set(contact.email, contact);
  }
  const inputs = [...byEmail.values()].map(({ email, properties }) => {
    const agg = aggregateCustomer(history.filter((o) => lower(o.billing?.email) === email));
    const extra = Object.fromEntries(Object.entries(agg).filter(([, v]) => v !== null));
    return { idProperty: 'email', id: email, properties: { ...properties, ...extra } };
  });
  return batches('/crm/v3/objects/contacts/batch/upsert', inputs, 'contacts');
}

export function companySearchRequest(orders) {
  const domains = planCompanies(orders).map((c) => c.domain);
  if (!domains.length) return skip('company search');
  return post('/crm/v3/objects/companies/search', {
    filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'IN', values: domains }] }],
    properties: ['domain', 'name'],
    limit: BATCH,
  }, 'company search');
}

export function companyCreateRequest(orders, searchResponse) {
  const found = idMap([searchResponse], 'domain');
  const inputs = planCompanies(orders)
    .filter((c) => !found.has(c.domain))
    .map((c) => ({ properties: { domain: c.domain, name: c.name } }));
  return inputs.length ? post('/crm/v3/objects/companies/batch/create', { inputs }, 'company create') : skip('company create');
}

export const productRequests = (orders) =>
  batches('/crm/v3/objects/products/batch/upsert', buildProductInputs(orders), 'products');

export function dealRequests(orders, ctx) {
  const inputs = [];
  const problems = [];
  for (const order of orders) {
    try {
      inputs.push(buildDealInput(order, ctx));
    } catch (err) {
      problems.push({
        key: `unknown-status:${order.id}`,
        subject: `Woo order #${order.number ?? order.id} not synced: unknown status`,
        content: err.message,
        priority: 'HIGH',
      });
    }
  }
  return { requests: batches('/crm/v3/objects/deals/batch/upsert', inputs, 'deals'), problems };
}

export function lineItemRequests(orders, productIds) {
  const inputs = orders.flatMap(buildLineItemInputs).map(({ wooProductId, ...input }) => {
    const hsProductId = productIds.get(wooProductId);
    return hsProductId ? { ...input, properties: { ...input.properties, hs_product_id: hsProductId } } : input;
  });
  return batches('/crm/v3/objects/line_items/batch/upsert', inputs, 'line items');
}

/** value of `property` (lowercased) → HubSpot record id, from any number of batch/search responses. */
export function idMap(responses, property) {
  const map = new Map();
  for (const r of responses) {
    for (const rec of r?.body?.results ?? []) {
      const value = rec.properties?.[property];
      if (value != null) map.set(lower(value), String(rec.id));
    }
  }
  return map;
}

export function associationRequests({ orders, contactIds, companyIds, dealIds, lineItemIds }) {
  const pairs = { 'contacts/companies': new Map(), 'deals/contacts': new Map(), 'deals/companies': new Map(), 'line_items/deals': new Map() };
  const add = (kind, from, to) => { if (from && to) pairs[kind].set(`${from}>${to}`, { from: { id: from }, to: { id: to } }); };
  for (const order of orders) {
    const email = lower(order.billing?.email);
    const contactId = contactIds.get(email);
    const companyId = companyIds.get(companyDomain(email) ?? '');
    const dealId = dealIds.get(String(order.id));
    add('contacts/companies', contactId, companyId);
    add('deals/contacts', dealId, contactId);
    add('deals/companies', dealId, companyId);
    for (const item of order.line_items ?? []) add('line_items/deals', lineItemIds.get(String(item.id)), dealId);
  }
  return Object.entries(pairs).map(([kind, map]) => (map.size
    ? post(`/crm/v4/associations/${kind}/batch/associate/default`, { inputs: [...map.values()] }, `associate ${kind}`)
    : skip(`associate ${kind}`)));
}

export function syncProblems(orders, responses, extra = []) {
  const problems = [];
  for (const order of orders) {
    const contact = buildContactInput(order);
    if (!contact.email) {
      problems.push({
        key: `no-contact:${order.id}`,
        subject: `Woo order #${order.number ?? order.id} synced without a contact`,
        content: `Billing email "${order.billing?.email ?? ''}" was rejected (${contact.issues.join('; ')}). `
          + 'The deal was synced; fix the email in WooCommerce and save the order to link a contact.',
        priority: 'MEDIUM',
      });
    }
  }
  for (const r of responses) {
    for (const e of r?.body?.errors ?? []) {
      for (const id of e.context?.ids ?? ['unknown']) {
        problems.push({
          key: `batch:${String(r.label).replace(/ \d+$/, '')}:${id}`,
          subject: `HubSpot rejected ${r.label} record ${id}`,
          content: `${e.category ?? 'ERROR'}: ${e.message ?? ''}`.slice(0, 2000),
          priority: 'HIGH',
        });
      }
    }
  }
  return [...problems, ...extra];
}

export function ticketReadRequest(problems) {
  if (!problems.length) return skip('ticket lookup');
  return post('/crm/v3/objects/tickets/batch/read', {
    idProperty: 'sync_error_key',
    inputs: problems.slice(0, BATCH).map((p) => ({ id: p.key })),
    properties: ['sync_error_key'],
  }, 'ticket lookup');
}

export function ticketCreateRequest(problems, readResponse, ctx) {
  const existing = idMap([readResponse], 'sync_error_key');
  const inputs = problems.slice(0, BATCH)
    .filter((p) => !existing.has(lower(p.key)))
    .map((p) => ({
      properties: {
        sync_error_key: p.key,
        subject: p.subject,
        content: p.content,
        hs_pipeline: ctx.ticketPipelineId,
        hs_pipeline_stage: ctx.ticketStageNewId,
        hs_ticket_priority: p.priority,
      },
    }));
  return inputs.length ? post('/crm/v3/objects/tickets/batch/create', { inputs }, 'tickets') : skip('tickets');
}
