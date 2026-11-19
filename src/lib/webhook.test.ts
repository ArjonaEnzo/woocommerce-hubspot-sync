import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWooSignature } from './webhook.ts';

const secret = 'test-secret';
const body = '{"id":101,"status":"completed"}';
const sign = (b: string, s = secret) => createHmac('sha256', s).update(b, 'utf8').digest('base64');

test('verifyWooSignature accepts the signature Woo computes', () => {
  assert.equal(verifyWooSignature(body, sign(body), secret), true);
});

test('verifyWooSignature rejects a tampered body', () => {
  assert.equal(verifyWooSignature(body.replace('101', '102'), sign(body), secret), false);
});

test('verifyWooSignature rejects a signature made with another secret', () => {
  assert.equal(verifyWooSignature(body, sign(body, 'other'), secret), false);
});

test('verifyWooSignature returns false (no throw) on missing or wrong-length headers', () => {
  assert.equal(verifyWooSignature(body, 'short', secret), false);
  assert.equal(verifyWooSignature(body, undefined, secret), false);
  assert.equal(verifyWooSignature(body, sign(body), ''), false, 'empty secret never validates');
});

import { safeEqual } from './webhook.ts';

test('safeEqual compares tokens in constant time and never throws', () => {
  assert.equal(safeEqual('token-123', 'token-123'), true);
  assert.equal(safeEqual('token-123', 'token-124'), false);
  assert.equal(safeEqual('short', 'longer-token'), false);
  assert.equal(safeEqual(undefined, 'x'), false);
  assert.equal(safeEqual('', ''), false, 'empty secret never matches');
});
