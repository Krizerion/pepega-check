import { backoffMs, createLimiter, isRetryable } from './throttle';

describe('createLimiter', () => {
  it('never runs more than the limit at once', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;

    const task = () =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });

    await Promise.all(Array.from({ length: 10 }, task));

    expect(peak).toBe(2);
  });

  it('runs every task even when some reject', async () => {
    const limit = createLimiter(2);
    let finished = 0;

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        limit(async () => {
          await new Promise((r) => setTimeout(r, 1));
          finished++;
          if (i % 2 === 0) {
            throw new Error('boom');
          }
          return i;
        }),
      ),
    );

    // A rejected task must still release its slot, or the queue deadlocks.
    expect(finished).toBe(6);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3);
  });

  it('preserves arrival order for queued tasks', async () => {
    const limit = createLimiter(1);
    const order: number[] = [];

    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        limit(async () => {
          await new Promise((r) => setTimeout(r, 1));
          order.push(i);
        }),
      ),
    );

    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('backoffMs', () => {
  it('honours Retry-After given in seconds', () => {
    expect(backoffMs('5', 1)).toBe(5000);
  });

  it('honours Retry-After given as an HTTP date', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const then = new Date(now + 8000).toUTCString();

    expect(backoffMs(then, 1, now)).toBeLessThanOrEqual(8000);
    expect(backoffMs(then, 1, now)).toBeGreaterThan(6500);
  });

  it('backs off exponentially when the server says nothing', () => {
    const first = backoffMs(null, 1);
    const third = backoffMs(null, 3);

    expect(first).toBeGreaterThanOrEqual(1000);
    expect(first).toBeLessThan(1300);
    expect(third).toBeGreaterThanOrEqual(4000);
  });

  it('caps however long the server asks for', () => {
    expect(backoffMs('9999', 1)).toBe(30_000);
  });

  it('never returns a negative wait for a date in the past', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const past = new Date(now - 60_000).toUTCString();

    expect(backoffMs(past, 1, now)).toBe(0);
  });
});

describe('isRetryable', () => {
  it('retries rate limiting and transient server faults', () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(503)).toBe(true);
  });

  it('does not retry the ones that will never succeed', () => {
    expect(isRetryable(401)).toBe(false);
    expect(isRetryable(404)).toBe(false);
    expect(isRetryable(400)).toBe(false);
  });
});
