// Shared core of F1 (backfill) and F2 (real-time): syncs ≤100 Woo orders into HubSpot.
// Input item: { orders: WooOrder[], history?: WooOrder[] }  (history = every order of those customers,
// used for total_orders / woo_total_revenue / first & last order date).
// Order of writes: contacts → companies (upsert by unique woo_company_domain) → products (search, then update or
// create: HubSpot cannot key products by a custom unique property) → deals → line items (upsert by unique woo_line_item_key)
// → associations → error tickets. Every HubSpot call goes through the "HubSpot request" sub-workflow.
import { IDS, code, subWorkflowTrigger, callWorkflow, workflow, chain } from './n8n.mjs';

const LIBS = ['src/lib/validate.ts', 'src/lib/hubspot-schema.js', 'src/lib/retry.js', 'src/lib/mapping.js', 'src/lib/sync-plan.js'];

export default function build({ inline }) {
  const lib = inline(LIBS);
  const prelude = `${lib}

// ---- step ----
const input = $('Sync in').first().json;
const orders = input.orders;
const history = input.history ?? orders;
const responses = (node) => $(node).all().map((item) => item.json);
const ctx = () => { const [deals, tickets] = responses('Get pipelines'); return pipelineContext(deals.body, tickets.body); };
const out = (requests) => [].concat(requests).map((json) => ({ json }));
`;
  const step = (name, body) => code(name, `${prelude}${body.trim()}\n`);
  const call = (name) => callWorkflow(name, IDS.hubspotRequest);

  const nodes = [
    subWorkflowTrigger('Sync in'),
    code('Pipelines req', `return [
  { json: { method: 'GET', path: '/crm/v3/pipelines/deals', label: 'deal pipelines' } },
  { json: { method: 'GET', path: '/crm/v3/pipelines/tickets', label: 'ticket pipelines' } },
];`),
    call('Get pipelines'),
    step('Contacts req', 'ctx(); // fail fast if the HubSpot setup was not run\nreturn out(contactRequests(orders, history));'),
    call('Upsert contacts'),
    step('Companies req', 'return out(companyRequests(orders));'),
    call('Upsert companies'),
    step('Product search req', 'return out(productSearchRequests(orders));'),
    call('Search products'),
    step('Products req', "return out(productWriteRequests(orders, responses('Search products')));"),
    call('Upsert products'),
    step('Deals req', 'return out(dealRequests(orders, ctx()).requests);'),
    call('Upsert deals'),
    step('Line items req', `const productIds = idMap([...responses('Search products'), ...responses('Upsert products')], 'woo_product_id');
return out(lineItemRequests(orders, productIds));`),
    call('Upsert line items'),
    step('Associations req', `return out(associationRequests({
  orders,
  contactIds: idMap(responses('Upsert contacts'), 'email'),
  companyIds: idMap(responses('Upsert companies'), 'woo_company_domain'),
  dealIds: idMap(responses('Upsert deals'), 'woo_order_id'),
  lineItemIds: idMap(responses('Upsert line items'), 'woo_line_item_key'),
}));`),
    call('Associate'),
    step('Ticket lookup req', `const written = ['Upsert contacts', 'Upsert companies', 'Upsert products', 'Upsert deals', 'Upsert line items', 'Associate']
  .flatMap(responses);
const problems = syncProblems(orders, written, dealRequests(orders, ctx()).problems);
return out(ticketReadRequest(problems));`),
    call('Find tickets'),
    step('Tickets req', `const written = ['Upsert contacts', 'Upsert companies', 'Upsert products', 'Upsert deals', 'Upsert line items', 'Associate']
  .flatMap(responses);
const problems = syncProblems(orders, written, dealRequests(orders, ctx()).problems);
return out(ticketCreateRequest(problems, responses('Find tickets')[0], ctx()));`),
    call('Create tickets'),
    step('Summary', `const count = (node) => responses(node).reduce((n, r) => n + (r.body?.results?.length ?? 0), 0);
return [{ json: {
  orders: orders.length,
  contacts: count('Upsert contacts'),
  companies: count('Upsert companies'),
  products: count('Upsert products'),
  deals: count('Upsert deals'),
  lineItems: count('Upsert line items'),
  associations: count('Associate'),
  ticketsCreated: count('Create tickets'),
  rejectedBatches: ['Upsert contacts', 'Upsert companies', 'Upsert products', 'Upsert deals', 'Upsert line items', 'Associate']
    .flatMap(responses).filter((r) => r.ok === false).length,
  requests: ['Get pipelines', 'Upsert contacts', 'Upsert companies', 'Search products', 'Upsert products',
    'Upsert deals', 'Upsert line items', 'Associate', 'Find tickets', 'Create tickets']
    .flatMap(responses).filter((r) => !r.skipped).length,
} }];`),
  ];

  return workflow({
    id: IDS.syncOrders,
    name: 'Sync orders → HubSpot (core)',
    nodes,
    links: chain(nodes.map((n) => n.name)),
    settings: { callerPolicy: 'workflowsFromSameOwner' },
  });
}
