/**
 * Request pacing for the Warcraft Logs API.
 *
 * The app fans out aggressively by design — opening a raider's view asks for
 * every pull at once, and each pull is three queries that may each paginate.
 * On a forty-pull encounter that is well over a hundred requests in flight,
 * which is the quickest way to get the whole session throttled.
 */

/** Statuses worth trying again: rate limiting, and transient server faults. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Never wait longer than this between attempts, whatever the server asks. */
const MAX_BACKOFF_MS = 30_000;

export function isRetryable(status: number): boolean {
  return RETRYABLE.has(status);
}

/**
 * Runs at most `max` tasks concurrently; the rest wait their turn in order.
 *
 * Deliberately tiny and dependency-free: the whole job is to own one counter
 * and a queue of resolvers.
 */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/**
 * How long to wait before retrying.
 *
 * `Retry-After` is honoured when the server sends it — it may be either a
 * number of seconds or an HTTP date — and otherwise the wait doubles each
 * attempt. The jitter matters: without it, a fan-out that was throttled
 * together retries together and gets throttled again.
 */
export function backoffMs(retryAfter: string | null, attempt: number, now = Date.now()): number {
  const fromHeader = parseRetryAfter(retryAfter, now);
  if (fromHeader !== null) {
    return Math.min(fromHeader, MAX_BACKOFF_MS);
  }
  const exponential = 1000 * 2 ** (attempt - 1);
  const jitter = Math.random() * 250;
  return Math.min(exponential + jitter, MAX_BACKOFF_MS);
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
