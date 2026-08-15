import { describe, it, expect } from 'vitest';
import { classify, createUpdateChecker } from '../src/update/check.js';

const DAY = 24 * 60 * 60 * 1000;

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

  it('fetches once, then serves the 24h cache without a second request', async () => {
    const { c, calls, tick } = checker();
    expect((await c.check()).latest).toBe('0.2.0');
    tick(DAY / 2);
    expect((await c.check()).latest).toBe('0.2.0');
    expect(calls).toHaveLength(1);
    tick(DAY);
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
