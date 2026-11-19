// F2 — real time. Woo webhooks order.created / order.updated → verify HMAC → answer Woo right away →
// fetch that customer's order history → sync-orders. Bad signature → 401 and nothing is written.
import { IDS, CREDENTIALS, node, code, callWorkflow, ifTrue, workflow } from './n8n.mjs';

export default function build({ inline }) {
  const lib = inline(['src/lib/webhook.ts']);
  const nodes = [
    node('Woo webhook', 'n8n-nodes-base.webhook', 2, {
      httpMethod: 'POST',
      path: 'woo-orders',
      responseMode: 'responseNode',
      options: { rawBody: true },
    }, { webhookId: '6f1c2a3e-7d1b-4b8e-9a51-a1b2c3d4e5f6' }),
    code('Verify', `${lib}

const item = $input.first();
const headers = item.json.headers ?? {};
const raw = item.binary?.data
  ? (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8')
  : JSON.stringify(item.json.body ?? {});
const body = item.json.body ?? {};

// Woo pings the URL once when the webhook is saved (form-encoded webhook_id, no order).
if (body.webhook_id && !body.id) return [{ json: { action: 'ping' } }];

if (!verifyWooSignature(raw, headers['x-wc-webhook-signature'], $env.WOO_WEBHOOK_SECRET)) {
  return [{ json: { action: 'reject', reason: 'invalid signature' } }];
}
const order = JSON.parse(raw);
return [{ json: { action: 'sync', topic: headers['x-wc-webhook-topic'], order, email: String(order.billing?.email ?? '').trim().toLowerCase() } }];`),
    ifTrue('Rejected?', "={{ $json.action === 'reject' }}"),
    node('Respond 401', 'n8n-nodes-base.respondToWebhook', 1.1, {
      respondWith: 'json', responseBody: '={{ { "error": "invalid signature" } }}', options: { responseCode: 401 },
    }),
    node('Respond 200', 'n8n-nodes-base.respondToWebhook', 1.1, {
      respondWith: 'json', responseBody: '={{ { "received": $json.action } }}', options: { responseCode: 200 },
    }),
    code('Only orders', "return $input.all().filter((item) => item.json.action === 'sync');"),
    node('Customer history', 'n8n-nodes-base.httpRequest', 4.2, {
      method: 'GET',
      url: '={{ $env.WOO_BASE_URL }}/wp-json/wc/v3/orders',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBasicAuth',
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'search', value: "={{ $json.email || 'no-email' }}" }, { name: 'per_page', value: '100' },
      ] },
      options: {},
    }, { credentials: CREDENTIALS.woo, alwaysOutputData: true }),
    // Webhooks can arrive late or out of order (an old "completed" after the refund). The order is re-read
    // from Woo in "Customer history", so what gets synced is always its current state, not the payload's.
    code('Build sync input', `const { order: payload, email } = $('Only orders').first().json;
const found = $input.all().map((item) => item.json).filter((o) => o && o.id);
const current = found.find((o) => o.id === payload.id) ?? payload;
const history = found.filter((o) => o.id !== current.id && String(o.billing?.email ?? '').trim().toLowerCase() === email);
return [{ json: { orders: [current], history: [...history, current] } }];`),
    callWorkflow('Sync order', IDS.syncOrders),
  ];

  return workflow({
    id: IDS.realtime,
    name: 'F2 · Woo → HubSpot real time',
    nodes,
    links: [
      ['Woo webhook', 'Verify'],
      ['Verify', 'Rejected?'],
      ['Rejected?', 'Respond 401', 0],
      ['Rejected?', 'Respond 200', 1],
      ['Respond 200', 'Only orders'],
      ['Only orders', 'Customer history'],
      ['Customer history', 'Build sync input'],
      ['Build sync input', 'Sync order'],
    ],
    settings: { errorWorkflow: IDS.errorHandler },
  });
}
