// F4 core — one HubSpot API request with exponential backoff on 429/5xx (1 s, 2 s; 3 attempts).
// Input item:  { method, path, body?, label, skip?, tolerateClientError?, ids? }
// Output item: { ok: true, status, body, label, ids, skipped? }. With tolerateClientError a 4xx answer comes
// back as { ok: false, status, body, label, ids } (the caller turns it into a ticket). Otherwise it fails with a clear message,
// which fails the caller and triggers the error workflow (ticket in "Integration errors").
import { IDS, CREDENTIALS, code, node, subWorkflowTrigger, ifTrue, workflow } from './n8n.mjs';

export default function build({ inline }) {
  const lib = inline(['src/lib/retry.js']);
  const req = "$('Prepare').first().json";
  const http = (name, bodyParams) => node(name, 'n8n-nodes-base.httpRequest', 4.2, {
    method: `={{ ${req}.method }}`,
    url: `={{ ${req}.url }}`,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'hubspotAppToken',
    ...bodyParams,
    options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 30000 },
  }, {
    credentials: CREDENTIALS.hubspot,
    // HTTP statuses never throw here (neverError → Classify decides). A dropped connection does throw,
    // so n8n's own retry covers that case: 3 tries, 3 s apart.
    retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
  });

  const nodes = [
    subWorkflowTrigger('Request in'),
    code('Prepare', `
const req = $input.first().json;
const base = ($env.HUBSPOT_BASE_URL || 'https://api.hubapi.com').replace(/\\/$/, '');
return [{ json: { ...req, url: base + req.path, hasBody: req.body != null } }];`),
    ifTrue('Skip?', '={{ $json.skip === true }}'),
    // Two HTTP nodes because n8n drops body parameters when "sendBody" is an expression.
    ifTrue('Has body?', `={{ ${req}.hasBody }}`),
    http('HubSpot API (body)', {
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify(${req}.body) }}`,
    }),
    http('HubSpot API', {}),
    code('Classify', `${lib}

const req = ${req};
const res = $input.first().json;
const attempt = $runIndex + 1;
const status = res.statusCode;
if (status >= 200 && status < 300) {
  return [{ json: { ok: true, status, body: res.body, label: req.label, ids: req.ids } }];
}
if (shouldRetry(status) && attempt < MAX_ATTEMPTS) {
  const headers = res.headers || {};
  const waitMs = backoffDelayMs(attempt, headers['retry-after'], status);
  return [{ json: { retry: true, attempt, status, waitSeconds: waitMs / 1000 } }];
}
if (req.tolerateClientError && status >= 400 && status < 500 && !shouldRetry(status)) {
  return [{ json: { ok: false, status, body: res.body, label: req.label, ids: req.ids } }];
}
const excerpt = JSON.stringify(res.body ?? '').slice(0, 500);
throw new Error(\`HubSpot \${req.method} \${req.path} [\${req.label}] failed after \${attempt} attempt(s): HTTP \${status} \${excerpt}\`);`),
    ifTrue('Retry?', '={{ $json.retry === true }}'),
    node('Back off', 'n8n-nodes-base.wait', 1.1, {
      resume: 'timeInterval', amount: '={{ $json.waitSeconds }}', unit: 'seconds',
    }),
    code('Return', `
return $input.all().map((item) => item.json.skip
  ? { json: { ok: true, skipped: true, status: 0, body: null, label: item.json.label } }
  : item);`),
  ];

  return workflow({
    id: IDS.hubspotRequest,
    name: 'HubSpot request (retry + backoff)',
    nodes,
    links: [
      ['Request in', 'Prepare'],
      ['Prepare', 'Skip?'],
      ['Skip?', 'Return', 0],
      ['Skip?', 'Has body?', 1],
      ['Has body?', 'HubSpot API (body)', 0],
      ['Has body?', 'HubSpot API', 1],
      ['HubSpot API (body)', 'Classify'],
      ['HubSpot API', 'Classify'],
      ['Classify', 'Retry?'],
      ['Retry?', 'Back off', 0],
      ['Retry?', 'Return', 1],
      ['Back off', 'Has body?'],
    ],
    settings: { callerPolicy: 'workflowsFromSameOwner' },
  });
}
