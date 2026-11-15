// F4 core — one HubSpot API request with exponential backoff on 429/5xx (1 s, 2 s; 3 attempts).
// Input item:  { method, path, body?, label, skip? }
// Output item: { ok: true, status, body, label, skipped? }  — or the execution fails with a clear message,
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
  }, { credentials: CREDENTIALS.hubspot });

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
  return [{ json: { ok: true, status, body: res.body, label: req.label } }];
}
if (shouldRetry(status) && attempt < MAX_ATTEMPTS) {
  const headers = res.headers || {};
  const waitMs = backoffDelayMs(attempt, headers['retry-after']);
  return [{ json: { retry: true, attempt, status, waitSeconds: waitMs / 1000 } }];
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
