#!/usr/bin/env node
// Idempotent HubSpot schema setup: property group + properties, deal pipeline "WooCommerce",
// ticket pipeline "Integration errors". Writes the ids n8n needs to .hubspot-ids.json (gitignored).
// Needs HUBSPOT_SERVICE_KEY in the environment (or in a local env file loaded below). Never prints it.
import { existsSync, writeFileSync } from 'node:fs';
import { PROPERTY_GROUP, PROPERTIES, DEAL_PIPELINE, TICKET_PIPELINE } from '../src/lib/hubspot-schema.ts';

const envFile = new URL('../.env', import.meta.url);
if (!process.env.HUBSPOT_SERVICE_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
const token = process.env.HUBSPOT_SERVICE_KEY;
if (!token) {
  console.error('HUBSPOT_SERVICE_KEY is not set.');
  process.exit(1);
}

const API = 'https://api.hubapi.com';
let created = 0;

async function hs(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

async function ensure(label, getPath, createPath, payload) {
  const found = await hs('GET', getPath);
  if (found.status === 200) return found.data;
  if (found.status !== 404) throw new Error(`${label}: GET ${getPath} → ${found.status} ${JSON.stringify(found.data)}`);
  const res = await hs('POST', createPath, payload);
  if (res.status === 409) return res.data; // created concurrently / already there
  if (res.status >= 300) throw new Error(`${label}: POST ${createPath} → ${res.status} ${JSON.stringify(res.data)}`);
  created++;
  console.log(`  created ${label}`);
  return res.data;
}

async function ensurePipeline(objectType, def) {
  const list = await hs('GET', `/crm/v3/pipelines/${objectType}`);
  if (list.status !== 200) throw new Error(`pipelines ${objectType} → ${list.status} ${JSON.stringify(list.data)}`);
  let pipeline = list.data.results.find((p) => p.label === def.label);
  if (!pipeline) {
    const res = await hs('POST', `/crm/v3/pipelines/${objectType}`, {
      label: def.label,
      displayOrder: def.displayOrder,
      stages: def.stages.map(({ label, displayOrder, metadata }) => ({ label, displayOrder, metadata })),
    });
    if (res.status >= 300) throw new Error(`create pipeline ${def.label} → ${res.status} ${JSON.stringify(res.data)}`);
    pipeline = res.data;
    created++;
    console.log(`  created ${objectType} pipeline "${def.label}"`);
  }
  const stageIds = {};
  for (const s of def.stages) {
    const match = pipeline.stages.find((x) => x.label === s.label);
    if (!match) throw new Error(`Pipeline "${def.label}" exists but has no stage "${s.label}" — fix it in HubSpot`);
    stageIds[s.key] = match.id;
  }
  return { pipelineId: pipeline.id, stageIds };
}

for (const [objectType, props] of Object.entries(PROPERTIES)) {
  console.log(objectType);
  await ensure(`${objectType} group`, `/crm/v3/properties/${objectType}/groups/${PROPERTY_GROUP.name}`,
    `/crm/v3/properties/${objectType}/groups`, PROPERTY_GROUP);
  for (const p of props) {
    const existing = await ensure(`${objectType}.${p.name}`, `/crm/v3/properties/${objectType}/${p.name}`,
      `/crm/v3/properties/${objectType}`, p);
    if (existing?.hubspotDefined) {
      throw new Error(`${objectType}.${p.name} is a HubSpot default property (group "${existing.groupName}"), `
        + 'not ours — rename it in src/lib/hubspot-schema.ts.');
    }
    if (p.hasUniqueValue && existing && existing.hasUniqueValue === false) {
      throw new Error(`${objectType}.${p.name} exists but is not unique — upserts by it would fail. `
        + 'Delete the property in HubSpot (Settings > Properties) and run this script again.');
    }
  }
}

const deals = await ensurePipeline('deals', DEAL_PIPELINE);
const tickets = await ensurePipeline('tickets', TICKET_PIPELINE);
const ids = {
  pipelineId: deals.pipelineId,
  stageIds: deals.stageIds,
  ticketPipelineId: tickets.pipelineId,
  ticketStageNewId: tickets.stageIds.new,
};
writeFileSync(new URL('../.hubspot-ids.json', import.meta.url), `${JSON.stringify(ids, null, 2)}\n`);
console.log(`\n${created} created. Ids written to .hubspot-ids.json:`);
console.log(JSON.stringify(ids, null, 2));
