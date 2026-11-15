// WooCommerce webhook signature check (flow F2).
// Woo sends X-WC-Webhook-Signature = base64(HMAC-SHA256(raw body, secret)).
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWooSignature(rawBody, signatureHeader, secret) {
  if (!secret || typeof signatureHeader !== 'string') return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64'));
  const received = Buffer.from(signatureHeader.trim());
  return expected.length === received.length && timingSafeEqual(expected, received);
}
