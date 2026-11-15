// Retry policy for HubSpot calls (flow F4). Ceiling: 100 requests / 10 s, batches of ≤100.

export const MAX_ATTEMPTS = 3;

export function shouldRetry(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

export function backoffDelayMs(attempt, retryAfterHeader) {
  const retryAfter = Number(retryAfterHeader);
  if (retryAfterHeader != null && Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return 1000 * 2 ** (attempt - 1);
}

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
