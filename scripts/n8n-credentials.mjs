#!/usr/bin/env node
// Creates/updates the two n8n credentials the workflows reference (ids in workflows/src/n8n.mjs)
// from the local .env. Values go straight into the n8n container via stdin; nothing is printed.
// Without HUBSPOT_SERVICE_KEY it stores a placeholder that only works against hubspot-mock.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { CREDENTIALS } from '../workflows/src/n8n.mjs';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { WP_ADMIN_USER, WOO_APP_PASSWORD, HUBSPOT_SERVICE_KEY } = process.env;
if (!WP_ADMIN_USER || !WOO_APP_PASSWORD) {
  console.error('WP_ADMIN_USER / WOO_APP_PASSWORD missing — run scripts/setup-woo.sh first.');
  process.exit(1);
}

const hub = CREDENTIALS.hubspot.hubspotAppToken;
const woo = CREDENTIALS.woo.httpBasicAuth;
const credentials = [
  { id: hub.id, name: hub.name, type: 'hubspotAppToken', data: { appToken: HUBSPOT_SERVICE_KEY || 'mock-token-not-a-secret' } },
  { id: woo.id, name: woo.name, type: 'httpBasicAuth', data: { user: WP_ADMIN_USER, password: WOO_APP_PASSWORD } },
];

const result = spawnSync('docker', ['compose', 'exec', '-T', 'n8n', 'sh', '-c',
  'cat > /tmp/creds.json && n8n import:credentials --input=/tmp/creds.json; status=$?; rm -f /tmp/creds.json; exit $status'], {
  input: JSON.stringify(credentials),
  encoding: 'utf8',
  env: { ...process.env, MSYS_NO_PATHCONV: '1' },
});
const out = `${result.stdout}${result.stderr}`.split('\n').filter((l) => /import|error/i.test(l)).join('\n');
console.log(out || '(no output)');
console.log(HUBSPOT_SERVICE_KEY ? 'HubSpot credential: real Service Key.' : 'HubSpot credential: placeholder (hubspot-mock only).');
process.exit(result.status ?? 1);
