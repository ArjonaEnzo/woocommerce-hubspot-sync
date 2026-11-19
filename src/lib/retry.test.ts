import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRetry, backoffDelayMs, chunk } from './retry.ts';

test('shouldRetry on rate limit and server errors only', () => {
  for (const s of [429, 500, 502, 503, 599]) assert.equal(shouldRetry(s), true, String(s));
  for (const s of [200, 400, 401, 404, 409]) assert.equal(shouldRetry(s), false, String(s));
});

test('backoffDelayMs doubles per attempt: 1s, 2s, 4s', () => {
  assert.equal(backoffDelayMs(1), 1000);
  assert.equal(backoffDelayMs(2), 2000);
  assert.equal(backoffDelayMs(3), 4000);
});

test('backoffDelayMs honors Retry-After seconds when present', () => {
  assert.equal(backoffDelayMs(2, '7'), 7000);
  assert.equal(backoffDelayMs(2, 'garbage'), 2000);
});

test('chunk splits into batches of at most size', () => {
  const arr = Array.from({ length: 250 }, (_, i) => i);
  assert.deepEqual(chunk(arr, 100).map((c) => c.length), [100, 100, 50]);
  assert.deepEqual(chunk([], 100), []);
});

test('shouldRetry also retries 423 Locked (HubSpot high-volume lock)', () => {
  assert.equal(shouldRetry(423), true);
});

test('backoffDelayMs waits out the 10 s rate window on 429 without Retry-After', () => {
  assert.equal(backoffDelayMs(1, undefined, 429), 10000);
  assert.equal(backoffDelayMs(2, undefined, 429), 10000);
  assert.equal(backoffDelayMs(1, '3', 429), 3000, 'Retry-After still wins');
});

test('backoffDelayMs waits at least 2 s on 423', () => {
  assert.equal(backoffDelayMs(1, undefined, 423), 2000);
  assert.equal(backoffDelayMs(3, undefined, 423), 4000);
});
