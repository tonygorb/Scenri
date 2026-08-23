import { afterEach, describe, it, expect, vi } from 'vitest';
import { CHECK_INTERVAL_MS, classify, createUpdateChecker, JITTER_RATIO, TICK_MS } from '../src/update/check.js';

const DAY = 24 * 60 * 60 * 1000;
const INTERVAL = CHECK_INTERVAL_MS;

function memStore() {
  const m = new Map<string, string>();
  return {
    getSetting: (k: string) => m.get(k) ?? null,
    setSetting: (k: string, v: string) => void m.set(k, v),
  };
}

function fetchStub(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const impl = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { impl, calls };
}

const distTags = (latest: string) => new Response(JSON.stringify({ latest }), { status: 200 });

function checker(overrides: Partial<Parameters<typeof createUpdateChecker>[0]> = {}) {
  const store = memStore();
  const { impl, calls } = fetchStub(() => distTags('0.2.0'));
  let t = 1_000_000;
  const c = createUpdateChecker({
    name: 'scenri',
    store,
    fetchImpl: impl,
    env: {},
    now: () => t,
    log: () => {},
    // Jitter pinned to zero so cadence assertions are exact; jitter has its own tests.
    random: () => 0,
    ...overrides,
  });
  return { c, store, calls, tick: (ms: number) => (t += ms) };
}

describe('semver classification', () => {
  it.each([
    ['0.1.0', '1.0.0', 'major'],
    ['0.1.0', '0.2.0', 'minor'],
    ['0.1.0', '0.1.1', 'patch'],
    ['0.2.0', '0.2.0', null],
    ['0.3.0', '0.2.9', null],
    ['1.2.3', '2.0.0', 'major'],
  ])('%s → %s is %s', (current, latest, kind) => {
    expect(classify(current, latest)).toBe(kind);
  });
});

describe('update checker', () => {
  it('is on by default, off via env, off via the settings toggle', () => {
    expect(checker().c.enabled()).toBe(true);
    expect(checker({ env: { SCENRI_NO_UPDATE_CHECK: '1' } }).c.enabled()).toBe(false);
    const { c, store } = checker();
    store.setSetting('update.enabled', 'false');
    expect(c.enabled()).toBe(false);
  });

  it('fetches once, then serves the cache until the interval has fully passed', async () => {
    const { c, calls, tick } = checker();
    expect((await c.check()).latest).toBe('0.2.0');
    tick(INTERVAL / 2);
    expect((await c.check()).latest).toBe('0.2.0');
    expect(calls).toHaveLength(1);
    tick(INTERVAL);
    await c.check();
    expect(calls).toHaveLength(2);
  });

  it('fetches once per interval in steady state, never every other tick', async () => {
    // The regression this guards: when the recheck period equaled the cache
    // TTL, each tick found a cache written one tick ago and skipped, so the
    // real cadence silently doubled to twice the documented interval.
    const { c, calls, tick } = checker();
    await c.check();
    let fetched = 1;
    for (let step = 0; step < (8 * INTERVAL) / TICK_MS; step++) {
      tick(TICK_MS);
      await c.check();
      if (calls.length > fetched) fetched = calls.length;
    }
    // Eight intervals of ticking: the initial fetch plus one per interval.
    expect(calls.length).toBe(1 + 8);
  });

  it('catches up on the first tick after a long sleep', async () => {
    const { c, calls, tick } = checker();
    await c.check();
    tick(3 * DAY); // the lid was closed
    await c.check();
    expect(calls).toHaveLength(2);
  });

  it('force bypasses the cache, but never more than once a minute, and concurrent forces share one request', async () => {
    const { c, calls, tick } = checker();
    await c.check();
    tick(1000);
    const [a, b] = await Promise.all([c.check(true), c.check(true)]);
    expect(a.latest).toBe('0.2.0');
    expect(b.latest).toBe('0.2.0');
    expect(calls).toHaveLength(2); // initial + one shared force
    tick(1000);
    await c.check(true); // inside the minute → cache
    expect(calls).toHaveLength(2);
    tick(61_000);
    await c.check(true);
    expect(calls).toHaveLength(3);
  });

  it('treats a 404 (fork name never published) as no update, and caches it', async () => {
    const { impl, calls } = fetchStub(() => new Response('{}', { status: 404 }));
    const { c } = checker({ fetchImpl: impl });
    const res = await c.check();
    expect(res.latest).toBeNull();
    expect(res.error).toBeNull();
    await c.check();
    expect(calls).toHaveLength(1);
  });

  it('keeps the previous answer through a network failure and surfaces the error', async () => {
    let fail = false;
    const { impl } = fetchStub(() => {
      if (fail) throw new Error('offline');
      return distTags('0.2.0');
    });
    const { c, tick } = checker({ fetchImpl: impl });
    await c.check();
    fail = true;
    tick(DAY + 1);
    const res = await c.check();
    expect(res.latest).toBe('0.2.0');
    expect(res.error).toContain('offline');
  });

  it('does not touch the network when disabled', async () => {
    const { c, calls } = checker({ env: { SCENRI_NO_UPDATE_CHECK: '1' } });
    expect((await c.check()).latest).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('a forced check answers even when the env switch is off', async () => {
    const { c, calls, store } = checker({ env: { SCENRI_NO_UPDATE_CHECK: '1' } });
    expect((await c.check()).latest).toBeNull();
    expect(calls).toHaveLength(0);
    const res = await c.check(true);
    expect(res.latest).toBe('0.2.0');
    expect(res.checkedAt).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(store.getSetting('update.checkedAt')).not.toBeNull();
  });

  it('the settings toggle gates the cadence, not the button', async () => {
    const { c, calls, store } = checker();
    store.setSetting('update.enabled', 'false');
    await c.check();
    expect(calls).toHaveLength(0);
    expect((await c.check(true)).latest).toBe('0.2.0');
    expect(calls).toHaveLength(1);
  });

  it('tells its subscriber on real registry answers only', async () => {
    const results: (string | null)[] = [];
    let fail = false;
    const { impl } = fetchStub(() => {
      if (fail) throw new Error('offline');
      return distTags('0.2.0');
    });
    const { c, tick } = checker({ fetchImpl: impl });
    c.onResult((r) => results.push(r.latest));
    await c.check(); // real fetch: fires
    await c.check(); // cache hit: silent
    fail = true;
    tick(DAY + 1);
    await c.check(); // failure: silent
    expect(results).toEqual(['0.2.0']);
  });

  it('prints the opt-out disclosure exactly once, on the first check ever', async () => {
    const lines: string[] = [];
    const { c, tick } = checker({ log: (l: string) => lines.push(l) });
    await c.check();
    tick(DAY + 1);
    await c.check();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('SCENRI_NO_UPDATE_CHECK');
  });

  it('asks the registry the caller named, not a hardcoded one', async () => {
    const { impl, calls } = fetchStub(() => distTags('0.2.0'));
    const { c } = checker({ fetchImpl: impl, registry: 'http://127.0.0.1:9999/reg' });
    await c.check();
    expect(calls[0]).toBe('http://127.0.0.1:9999/reg/-/package/scenri/dist-tags');
  });
});

describe('jitter', () => {
  it('stretches the interval by up to the jitter ratio, so a fleet cannot re-synchronize', async () => {
    const { c, calls, tick } = checker({ random: () => 1 }); // maximum jitter
    await c.check();
    tick(INTERVAL + Math.floor(JITTER_RATIO * INTERVAL) - 1);
    await c.check();
    expect(calls).toHaveLength(1); // still inside interval + jitter
    tick(2);
    await c.check();
    expect(calls).toHaveLength(2);
  });

  it('draws a fresh jitter after every real fetch', async () => {
    const draws: number[] = [];
    const { c, tick } = checker({
      random: () => {
        draws.push(1);
        return 0.5;
      },
    });
    await c.check();
    tick(INTERVAL * 2);
    await c.check();
    expect(draws.length).toBeGreaterThanOrEqual(2);
  });
});

describe('cadence overrides for harnesses', () => {
  it('honours the env overrides when the registry is not npmjs', async () => {
    const { c, calls, tick } = checker({
      registry: 'http://127.0.0.1:9999/reg',
      env: { SCENRI_UPDATE_INTERVAL_MS: '5000' },
    });
    await c.check();
    tick(5001);
    await c.check();
    expect(calls).toHaveLength(2);
  });

  it('clamps the overrides against the public registry, so nothing can hammer npm', async () => {
    const { c, calls, tick } = checker({ env: { SCENRI_UPDATE_INTERVAL_MS: '1000' } });
    await c.check();
    tick(60 * 60 * 1000 - 1); // just under the one-hour floor
    await c.check();
    expect(calls).toHaveLength(1);
    tick(2);
    await c.check();
    expect(calls).toHaveLength(2);
  });
});

describe('schedule', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a running process discovers staleness by itself: boot look, then cheap ticks that fetch only when stale', async () => {
    vi.useFakeTimers();
    const store = memStore();
    const { impl, calls } = fetchStub(() => distTags('0.2.0'));
    let t = 1_000_000;
    const c = createUpdateChecker({
      name: 'scenri',
      store,
      fetchImpl: impl,
      env: { SCENRI_UPDATE_INTERVAL_MS: '5000', SCENRI_UPDATE_TICK_MS: '1000' },
      registry: 'http://127.0.0.1:9999/reg',
      now: () => t,
      log: () => {},
      random: () => 0,
    });
    c.schedule();

    await vi.advanceTimersByTimeAsync(10_000); // the boot look
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3000); // three ticks inside the interval
    expect(calls).toHaveLength(1);

    t += 5001; // the wall clock passed the interval (or the machine slept)
    await vi.advanceTimersByTimeAsync(1000); // the very next tick fetches
    expect(calls).toHaveLength(2);
  });
});
