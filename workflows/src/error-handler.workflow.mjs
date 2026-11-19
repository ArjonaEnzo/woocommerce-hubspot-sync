// F4 — error workflow for F1/F2. Any failed execution (e.g. HubSpot still answering 429/5xx after
// 3 attempts) becomes a ticket in the "Integration errors" pipeline, one per failed execution.
// If HubSpot itself is unreachable this ticket fails too; the failure stays in n8n's execution log.
import { IDS, code, node, callWorkflow, workflow, chain } from './n8n.mjs';

export default function build({ inline }) {
  const lib = inline(['src/lib/hubspot-schema.ts', 'src/lib/retry.ts', 'src/lib/validate.ts', 'src/lib/mapping.ts', 'src/lib/sync-plan.js']);
  const nodes = [
    node('On error', 'n8n-nodes-base.errorTrigger', 1),
    code('Pipelines req', `return [
  { json: { method: 'GET', path: '/crm/v3/pipelines/deals', label: 'deal pipelines' } },
  { json: { method: 'GET', path: '/crm/v3/pipelines/tickets', label: 'ticket pipelines' } },
];`),
    callWorkflow('Get pipelines', IDS.hubspotRequest),
    code('Ticket req', `${lib}

const failure = $('On error').first().json;
const [deals, tickets] = $('Get pipelines').all().map((item) => item.json);
const ctx = pipelineContext(deals.body, tickets.body);
const executionId = failure.execution?.id ?? 'unknown';
const problem = {
  key: \`execution:\${failure.workflow?.id ?? 'wf'}:\${executionId}\`,
  subject: \`Sync failed: \${failure.workflow?.name ?? 'workflow'} (execution \${executionId})\`,
  content: [
    \`Node: \${failure.execution?.lastNodeExecuted ?? '?'}\`,
    \`Error: \${failure.execution?.error?.message ?? 'unknown'}\`,
    failure.execution?.error?.description ? \`Cause: \${failure.execution.error.description}\` : '',
    failure.execution?.url ? \`Execution: \${failure.execution.url}\` : '',
    'Re-run the workflow after fixing the cause; every write is an upsert, so re-running is safe.',
  ].filter(Boolean).join('\\n').slice(0, 2000),
  priority: 'HIGH',
};
return [{ json: ticketCreateRequest([problem], null, ctx) }];`),
    callWorkflow('Create ticket', IDS.hubspotRequest),
  ];

  return workflow({
    id: IDS.errorHandler,
    name: 'F4 · Sync error → HubSpot ticket',
    nodes,
    links: chain(nodes.map((n) => n.name)),
  });
}
