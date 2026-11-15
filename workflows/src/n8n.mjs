// Tiny helpers to declare n8n workflows in code (built by scripts/build-workflows.mjs).
// Node parameter shapes match n8n 2.47 (see docker-compose.yml for the pinned image).

export const IDS = {
  hubspotRequest: 'wfHubspotReq0001',
  syncOrders: 'wfSyncOrders0001',
  backfill: 'wfBackfill000001',
  realtime: 'wfRealtime000001',
  errorHandler: 'wfErrorHandler01',
};

// Credentials are referenced by id + name only; scripts/n8n-credentials.mjs creates them locally.
export const CREDENTIALS = {
  hubspot: { hubspotAppToken: { id: 'credHubspot00001', name: 'HubSpot Service Key' } },
  woo: { httpBasicAuth: { id: 'credWooBasic0001', name: 'WooCommerce (WP application password)' } },
};

let counter = 0;
const nodeId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export function node(name, type, typeVersion, parameters = {}, extra = {}) {
  return { id: nodeId(), name, type, typeVersion, position: [0, 0], parameters, ...extra };
}

export const code = (name, jsCode, extra) => node(name, 'n8n-nodes-base.code', 2, { jsCode }, extra);

export const subWorkflowTrigger = (name) =>
  node(name, 'n8n-nodes-base.executeWorkflowTrigger', 1.1, { inputSource: 'passthrough' });

// mode "each": the sub-workflow runs once per input item (one HubSpot request per run).
export const callWorkflow = (name, workflowId, mode = 'each') =>
  node(name, 'n8n-nodes-base.executeWorkflow', 1.2, {
    workflowId: { __rl: true, mode: 'id', value: workflowId },
    mode,
    options: { waitForSubWorkflow: true },
  });

export const ifTrue = (name, expression) =>
  node(name, 'n8n-nodes-base.if', 2.2, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{
        id: `${name}-cond`,
        leftValue: expression,
        rightValue: '',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
      }],
      combinator: 'and',
    },
    options: {},
  });

/** Lays nodes out left→right and wires them in sequence (output 0 → input 0). */
export function workflow({ id, name, nodes, links = [], settings = {} }) {
  nodes.forEach((n, i) => { n.position = [i * 240, 0]; });
  const connections = {};
  const connect = (from, to, output = 0) => {
    connections[from] ??= { main: [] };
    while (connections[from].main.length <= output) connections[from].main.push([]);
    connections[from].main[output].push({ node: to, type: 'main', index: 0 });
  };
  for (const [from, to, output] of links) connect(from, to, output);
  return {
    id,
    name,
    active: false,
    isArchived: false,
    nodes,
    connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true, ...settings },
    pinData: {},
    tags: [],
  };
}

/** Links each node to the next one. */
export const chain = (names) => names.slice(1).map((to, i) => [names[i], to, 0]);
