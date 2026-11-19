import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { inlineModules, findSecrets, stripTypes } from './build-workflows.mjs';

const require = createRequire(import.meta.url);
// Evaluates inlined code the way an n8n Code node does: plain script with `require` in scope.
const evaluate = (code, names) => new Function('require', `${code}\nreturn { ${names.join(', ')} };`)(require);

test('inlineModules produces a plain script with the library functions', () => {
  const code = inlineModules(['src/lib/validate.ts', 'src/lib/mapping.js', 'src/lib/retry.js']);
  assert.doesNotMatch(code, /^\s*(import|export)\s/m);
  const { buildDealInput, backoffDelayMs } = evaluate(code, ['buildDealInput', 'backoffDelayMs']);
  assert.equal(backoffDelayMs(3), 4000);
  const deal = buildDealInput(
    { id: 1, number: '1', status: 'completed', total: '10.00', refunds: [], currency: 'USD', date_created_gmt: '2026-01-01T00:00:00', billing: {} },
    { pipelineId: 'p', stageIds: { closedwon: 'w' } },
  );
  assert.equal(deal.properties.dealstage, 'w');
});

test('inlineModules turns node:crypto imports into require calls', () => {
  const code = inlineModules(['src/lib/webhook.js']);
  assert.match(code, /const \{ createHmac, timingSafeEqual \} = require\('crypto'\);/);
  const { verifyWooSignature } = evaluate(code, ['verifyWooSignature']);
  const sig = createHmac('sha256', 's').update('b').digest('base64');
  assert.equal(verifyWooSignature('b', sig, 's'), true);
});

test('stripTypes removes TypeScript and keeps the JavaScript byte for byte', () => {
  const ts = [
    "import type { WooOrder } from './types.ts';",
    '',
    'interface Pair {',
    '  from: string;',
    '}',
    '',
    'const money = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);',
    'export function f(order: WooOrder, ids: Map<string, string> = new Map()): string | null {',
    '  const x = (order as { id: number }).id; // keep this comment',
    "  return ids.get(String(x))!;",
    '}',
  ].join('\n');
  // The blank lines that separated the removed type blocks stay (inlineModules trims each module anyway).
  assert.equal(stripTypes(ts), [
    '',
    '',
    'const money = (n) => (Math.round(n * 100) / 100).toFixed(2);',
    'export function f(order, ids = new Map()) {',
    '  const x = (order).id; // keep this comment',
    '  return ids.get(String(x));',
    '}',
  ].join('\n'));
});

test('stripTypes rejects syntax that cannot be erased (enums need a compiler)', () => {
  assert.throws(() => stripTypes('enum A { B }'), /enum|strip|TypeScript/i);
});

test('inlineModules fails loudly on a missing file', () => {
  assert.throws(() => inlineModules(['src/lib/nope.ts']), /ENOENT|nope\.ts/);
});

test('findSecrets flags tokens and passwords, ignores normal code', () => {
  assert.deepEqual(findSecrets('{"x":"const a = 1;"}'), []);
  // Built at runtime so secret scanners don't mistake this fake token for a real one.
  const fakeHubSpotKey = ['pat', 'na1', '11111111-2222-3333-4444-555555555555'].join('-');
  assert.equal(findSecrets(`"${fakeHubSpotKey}"`).length, 1);
  assert.equal(findSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456').length, 1);
  assert.equal(findSecrets('"abcd EFGH ijkl MNOP qrst UVWX"').length, 1, 'WordPress application password');
  assert.equal(findSecrets(`"${'a1'.repeat(32)}"`).length, 1, '64-hex webhook secret');
});

test('HubSpot HTTP nodes retry network errors (no HTTP status) on their own', async () => {
  // Found against the real API: a burst of webhooks got "The connection was aborted". Status codes are
  // handled by the Classify node (neverError), but a dropped connection throws before Classify runs.
  const { default: build } = await import('../workflows/src/hubspot-request.workflow.mjs');
  const wf = build({ inline: inlineModules });
  const httpNodes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.equal(httpNodes.length, 2);
  for (const n of httpNodes) {
    assert.equal(n.retryOnFail, true, n.name);
    assert.equal(n.maxTries, 3, n.name);
    assert.ok(n.waitBetweenTries >= 2000, n.name);
  }
});
