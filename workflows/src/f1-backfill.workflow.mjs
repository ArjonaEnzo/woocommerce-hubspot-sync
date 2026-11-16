// F1 — historical backfill. Reads every order through the Woo REST API (so it works with HPOS),
// then syncs them in chunks of 100. Every write is idempotent, so re-running it from chunk 0 is safe;
// startChunk only saves time when resuming a long run.
// Two triggers: the n8n editor (manual) or POST /webhook/woo-backfill with header x-backfill-token
// (= WOO_WEBHOOK_SECRET) and an optional JSON body {"startChunk": N}. A wrong token gets 401 and stops
// there (no error run, so no error ticket — a stranger cannot spam HubSpot).
import { IDS, CREDENTIALS, node, code, callWorkflow, ifTrue, workflow, chain } from './n8n.mjs';

export default function build({ inline }) {
  const nodes = [
    node('Start', 'n8n-nodes-base.manualTrigger', 1),
    node('Run via webhook', 'n8n-nodes-base.webhook', 2, {
      httpMethod: 'POST', path: 'woo-backfill', responseMode: 'responseNode', options: {},
    }, { webhookId: '0b7f3c1d-2e4a-4f6b-8c9d-0a1b2c3d4e5f' }),
    code('Check token', `${inline(['src/lib/webhook.js'])}

const trigger = $input.first().json;
const authorized = safeEqual(trigger.headers?.['x-backfill-token'], $env.WOO_WEBHOOK_SECRET);
return [{ json: { authorized, startChunk: Number(trigger.body?.startChunk ?? 0) } }];`),
    ifTrue('Authorized?', '={{ $json.authorized === true }}'),
    node('Respond 401', 'n8n-nodes-base.respondToWebhook', 1.1, {
      respondWith: 'json', responseBody: '={{ { "error": "missing or wrong x-backfill-token" } }}', options: { responseCode: 401 },
    }),
    node('Respond 202', 'n8n-nodes-base.respondToWebhook', 1.1, {
      respondWith: 'json', responseBody: '={{ { "started": true, "startChunk": $json.startChunk } }}', options: { responseCode: 202 },
    }),
    code('Config', 'return [{ json: { startChunk: Number($input.first().json.startChunk ?? 0), chunkSize: 100 } }];'),
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
    links: [
      ['Start', 'Config'],
      ['Run via webhook', 'Check token'],
      ['Check token', 'Authorized?'],
      ['Authorized?', 'Respond 202', 0],
      ['Authorized?', 'Respond 401', 1],
      ['Respond 202', 'Config'],
      ...chain(nodes.slice(nodes.findIndex((n) => n.name === 'Config')).map((n) => n.name)),
    ],
    settings: { errorWorkflow: IDS.errorHandler },
  });
}
