// Turns a batch of Woo orders into the ordered list of HubSpot requests the sync-orders workflow makes.
// Every function returns plain request objects { method, path, body, label } — or { skip: true, label }
// when there is nothing to send — so the n8n flow stays linear and every step is unit-tested here.
import { DEAL_PIPELINE, TICKET_PIPELINE } from './hubspot-schema.ts';
import { chunk } from './retry.ts';
import {
  buildContactInput, planCompanies, companyDomain, buildProductInputs, buildDealInput, buildLineItemInputs,
  aggregateCustomer,
} from './mapping.ts';

const BATCH = 100;
const skip = (label) => ({ skip: true, label });
const post = (path, body, label) => ({ method: 'POST', path, body, label });
// Batch writes tolerate 4xx: HubSpot rejects a whole batch for one bad record, and that must become a
// ticket naming the records, not abort the other 99 orders. `ids` lets the ticket say which records.
const batches = (path, inputs, label, idOf = (i) => i.id) =>
  (inputs.length
    ? chunk(inputs, BATCH).map((part, i) => ({
      ...post(path, { inputs: part }, `${label} ${i + 1}`), tolerateClientError: true, ids: part.map(idOf).map(String),
    }))
    : [skip(label)]);
const lower = (s) => String(s ?? '').trim().toLowerCase();

/** Searches `objectType` for records whose `property` is any of `values` (≤100 values per search). */
function searchIn(objectType, property, values, label) {
  const unique = [...new Set(values.map(String))];
  if (!unique.length) return [skip(label)];
  return chunk(unique, BATCH).map((part, i) => post(`/crm/v3/objects/${objectType}/search`, {
    filterGroups: [{ filters: [{ propertyName: property, operator: 'IN', values: part }] }],
    properties: [property],
    limit: BATCH,
  }, `${label} ${i + 1}`));
}

/** For objects HubSpot cannot upsert by our key: update what the search found, create the rest. */
function updateOrCreate(objectType, key, items, found, label) {
  const updates = [];
  const creates = [];
  for (const properties of items) {
    const id = found.get(lower(properties[key]));
    if (id) updates.push({ id, properties });
    else creates.push({ properties });
  }
  const idOf = (i) => i.properties[key];
  const requests = [
    ...(updates.length ? batches(`/crm/v3/objects/${objectType}/batch/update`, updates, `${label} update`, idOf) : []),
    ...(creates.length ? batches(`/crm/v3/objects/${objectType}/batch/create`, creates, `${label} create`, idOf) : []),
  ];
  return requests.length ? requests : [skip(label)];
}

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

// One company per business domain, enforced by HubSpot through the unique woo_company_domain property.
// (A search-then-create version raced: concurrent webhooks for a new domain each created a company.)
export function companyRequests(orders) {
  const inputs = planCompanies(orders).map((c) => ({
    idProperty: 'woo_company_domain',
    id: c.domain,
    properties: { woo_company_domain: c.domain, domain: c.domain, name: c.name },
  }));
  return batches('/crm/v3/objects/companies/batch/upsert', inputs, 'companies');
}

export const productSearchRequests = (orders) =>
  searchIn('products', 'woo_product_id', buildProductInputs(orders).map((p) => p.id), 'product search');

export const productWriteRequests = (orders, searchResponses) => updateOrCreate(
  'products', 'woo_product_id', buildProductInputs(orders).map((p) => p.properties),
  idMap(searchResponses, 'woo_product_id'), 'products',
);

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

// Upsert by the unique woo_line_item_key: one line item per Woo order item even when order.created and
// order.updated webhooks are processed at the same time (search-then-create duplicated them).
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
    ? { ...post(`/crm/v4/associations/${kind}/batch/associate/default`, { inputs: [...map.values()] }, `associate ${kind}`),
      tolerateClientError: true, ids: [...map.keys()] }
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
    if (r && r.ok === false) {
      const ids = r.ids ?? [];
      problems.push({
        key: `batch-failed:${String(r.label).replace(/ \d+$/, '')}:${ids[0] ?? 'none'}..${ids.at(-1) ?? 'none'}`,
        subject: `HubSpot rejected a whole ${r.label} batch (${ids.length} records)`,
        content: `HTTP ${r.status} ${r.body?.category ?? ''}: ${r.body?.message ?? JSON.stringify(r.body ?? '')}
`
          + `Records: ${ids.join(', ')}`.slice(0, 1800),
        priority: 'HIGH',
      });
      continue;
    }
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
  return searchIn('tickets', 'sync_error_key', problems.slice(0, BATCH).map((p) => p.key), 'ticket lookup')[0];
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
  return inputs.length
    ? batches('/crm/v3/objects/tickets/batch/create', inputs, 'tickets', (i) => i.properties.sync_error_key)[0]
    : skip('tickets');
}
