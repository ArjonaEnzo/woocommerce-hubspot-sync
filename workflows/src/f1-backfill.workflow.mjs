// F1 — historical backfill. Reads every order through the Woo REST API (so it works with HPOS),
// then syncs them in chunks of 100. Every write is an upsert, so re-running it is safe; to resume after
// a failure, set startChunk in "Config" to the chunk that failed (the Summary of each run lists them).
import { IDS, CREDENTIALS, node, code, callWorkflow, workflow, chain } from './n8n.mjs';

export default function build() {
  const nodes = [
    node('Start', 'n8n-nodes-base.manualTrigger', 1),
    code('Config', 'return [{ json: { startChunk: 0, chunkSize: 100 } }];'),
    node('Fetch Woo orders', 'n8n-nodes-base.httpRequest', 4.2, {
      method: 'GET',
      url: '={{ $env.WOO_BASE_URL }}/wp-json/wc/v3/orders',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBasicAuth',
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'per_page', value: '100' }, { name: 'orderby', value: 'id' }, { name: 'order', value: 'asc' },
      ] },
      options: {
        pagination: { pagination: {
          paginationMode: 'updateAParameterInEachRequest',
          parameters: { parameters: [{ type: 'qs', name: 'page', value: '={{ $pageCount + 1 }}' }] },
          paginationCompleteWhen: 'responseIsEmpty',
          limitPagesFetched: true,
          maxRequests: 500,
        } },
      },
    }, { credentials: CREDENTIALS.woo }),
    code('Chunk', `const { startChunk, chunkSize } = $('Config').first().json;
const all = $input.all().map((item) => item.json).filter((o) => o && o.id);
const emailOf = (o) => String(o.billing?.email ?? '').trim().toLowerCase();
const byEmail = new Map();
for (const o of all) byEmail.set(emailOf(o), [...(byEmail.get(emailOf(o)) ?? []), o]);
const chunks = [];
for (let i = 0; i * chunkSize < all.length; i++) {
  if (i < startChunk) continue;
  const orders = all.slice(i * chunkSize, (i + 1) * chunkSize);
  const history = [...new Set(orders.map(emailOf))].flatMap((e) => byEmail.get(e) ?? []);
  chunks.push({ json: { chunk: i, orders, history } });
}
return chunks;`),
    callWorkflow('Sync chunk', IDS.syncOrders),
    code('Summary', `const runs = $input.all().map((item, i) => ({ chunk: $('Chunk').all()[i].json.chunk, ...item.json }));
const total = (k) => runs.reduce((n, r) => n + (r[k] ?? 0), 0);
return [{ json: { chunks: runs.length, orders: total('orders'), deals: total('deals'), contacts: total('contacts'),
  lineItems: total('lineItems'), ticketsCreated: total('ticketsCreated'), requests: total('requests'), runs } }];`),
  ];

  return workflow({
    id: IDS.backfill,
    name: 'F1 · Woo → HubSpot backfill',
    nodes,
    links: chain(nodes.map((n) => n.name)),
    settings: { errorWorkflow: IDS.errorHandler },
  });
}
