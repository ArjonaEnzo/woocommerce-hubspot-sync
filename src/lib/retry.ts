// Retry policy for HubSpot calls (flow F4). Ceiling: 100 requests / 10 s, batches of ≤100.

export const MAX_ATTEMPTS = 3;

// 429 = rate limit, 423 = HubSpot's "Locked" during high sync volume, 5xx = transient server errors.
export function shouldRetry(status: number): boolean {
  return status === 429 || status === 423 || (status >= 500 && status <= 599);
}

// Exponential (1 s, 2 s, 4 s…), but never shorter than what the error needs: a 429 without Retry-After
// waits out the whole 10 s rate window; a 423 waits at least 2 s (HubSpot's guidance).
export function backoffDelayMs(attempt: number, retryAfterHeader?: string | number | null, status?: number): number {
  const retryAfter = Number(retryAfterHeader);
  if (retryAfterHeader != null && Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const exponential = 1000 * 2 ** (attempt - 1);
  if (status === 429) return Math.max(exponential, 10000);
  if (status === 423) return Math.max(exponential, 2000);
  return exponential;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
