// WooCommerce webhook signature check (flow F2).
// Woo sends X-WC-Webhook-Signature = base64(HMAC-SHA256(raw body, secret)).
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWooSignature(rawBody: string, signatureHeader: unknown, secret: string | null | undefined): boolean {
  if (!secret || typeof signatureHeader !== 'string') return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64'));
  const received = Buffer.from(signatureHeader.trim());
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// Constant-time comparison for shared tokens (backfill webhook). Empty never matches.
export function safeEqual(received: unknown, expected: unknown): boolean {
  if (typeof received !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
