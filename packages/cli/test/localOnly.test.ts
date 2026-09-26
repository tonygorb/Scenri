import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core } from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { drainTracked, track } from './servers.js';
import { CODE_SETTING } from '../src/network/phoneAccess.js';

/**
 * What only the computer running Scenri may do or see. A phone holding the
 * code uses the studio, but the code travels over plain http, so it never
 * reaches what acts on this computer or names its paths. And another app on
 * this computer (same-site, a page on another localhost port) may read but
 * never change anything.
 */

let home: string;
let core: Core;
const CODE = '482913';
const phone = { host: '192.168.1.42:4747', 'x-access-token': CODE };

const serve = (extra: Partial<Parameters<typeof buildServer>[0]> = {}) => {
  const demo = createDemoEngine((b) => core.images.save(b));
  let setups = 0;
  const app = track(
    buildServer({
      core,
      engines: { all: () => [demo], get: (id) => (id === demo.capabilities().id ? demo : null) },
      phone: { addresses: async () => [], listen: async () => ({ close: async () => undefined }) },
      codexSetup: {
        status: async () => ({ state: 'ready' }),
        install: async () => {
          setups++;
          return { ok: true };
        },
        login: async () => {
          setups++;
          return { ok: true };
        },
      } as any,
      ...extra,
    }),
  );
  return { app, setups: () => setups };
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-local-only-'));
  core = createCore(home);
  core.store.setSetting(CODE_SETTING, CODE);
});
afterEach(async () => {
  await drainTracked();
  try {
    core.close();
  } catch {
    // a drained server closes the core on its way out
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('a phone holding the code', () => {
  it('reads how big the library is, never where it lives', async () => {
    const { app } = serve();
    const remote = await app.inject({ method: 'GET', url: '/api/home', headers: phone, remoteAddress: '192.168.1.50' });
    expect(remote.statusCode).toBe(200);
    expect(remote.json()).not.toHaveProperty('dir');
    expect(remote.json()).not.toHaveProperty('dbPath');
    expect(remote.json()).toHaveProperty('images');
    const version = await app.inject({
      method: 'GET',
      url: '/api/version',
      headers: phone,
      remoteAddress: '192.168.1.50',
    });
    expect(version.json()).not.toHaveProperty('home');
    // this computer, over loopback, still sees both (the e2e harness reads home)
    expect((await app.inject({ method: 'GET', url: '/api/home' })).json().dir).toBe(home);
    expect((await app.inject({ method: 'GET', url: '/api/version' })).json().home).toBe(home);
  });

  it('cannot empty the library or run codex setup on this computer', async () => {
    const { app, setups } = serve();
    for (const [method, url] of [
      ['DELETE', '/api/data?scope=shots'],
      ['POST', '/api/engines/codex/install'],
      ['POST', '/api/engines/codex/login'],
      ['POST', '/api/engines/codex/repair-env'],
      ['POST', '/api/engines/codex/restore-env'],
    ] as const) {
      const res = await app.inject({ method, url, headers: phone, remoteAddress: '192.168.1.50' });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(setups()).toBe(0);
    // and this computer still can
    expect((await app.inject({ method: 'DELETE', url: '/api/data?scope=shots' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/engines/codex/install' })).statusCode).toBe(200);
    expect(setups()).toBe(1);
  });

  it('cannot shut Scenri down', async () => {
    const exits: number[] = [];
    const { app } = serve({ exitImpl: (code) => exits.push(code) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/quit',
      headers: phone,
      remoteAddress: '192.168.1.50',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('Only on the computer running Scenri.');
    // the route answers first and leaves 50ms later: give it the time
    await new Promise((r) => setTimeout(r, 150));
    expect(exits).toEqual([]);
  });

  describe('an update waiting', () => {
    const registry = (async (input: unknown) =>
      String(input).includes('/-/package/')
        ? new Response(JSON.stringify({ latest: '99.9.9' }), { status: 200 })
        : new Response('not found', { status: 404 })) as typeof fetch;
    const updating = () => {
      const exits: number[] = [];
      let staged = 0;
      const { app } = serve({
        fetchImpl: registry,
        runtime: { installKind: 'managed', supervised: true },
        stageImpl: async () => {
          staged++;
          return { ok: true as const, version: '99.9.9', entry: '/staged/entry' };
        },
        exitImpl: (code) => exits.push(code),
      });
      return { app, exits, staged: () => staged };
    };

    it('cannot install it', async () => {
      const { app, staged } = updating();
      const res = await app.inject({
        method: 'POST',
        url: '/api/update/apply',
        headers: phone,
        remoteAddress: '192.168.1.50',
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('Only on the computer running Scenri.');
      expect(staged()).toBe(0);
      // and this computer still can
      expect((await app.inject({ method: 'POST', url: '/api/update/apply' })).statusCode).toBe(200);
      expect(staged()).toBe(1);
    });

    it('cannot restart into it once this computer has downloaded it', async () => {
      const { app, exits } = updating();
      expect((await app.inject({ method: 'POST', url: '/api/update/apply' })).statusCode).toBe(200);
      await expect
        .poll(async () => (await app.inject({ method: 'GET', url: '/api/update/status' })).json().phase)
        .toBe('ready');
      const res = await app.inject({
        method: 'POST',
        url: '/api/update/restart',
        headers: phone,
        remoteAddress: '192.168.1.50',
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('Only on the computer running Scenri.');
      await new Promise((r) => setTimeout(r, 150));
      expect(exits).toEqual([]);
    });
  });
});

describe('another app on this computer', () => {
  const sameSite = { host: '127.0.0.1:4747', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors' };

  it('cannot change anything from a page on another localhost port', async () => {
    const { app } = serve();
    const before = (await app.inject({ method: 'GET', url: '/api/phone' })).json().code;
    const renew = await app.inject({ method: 'POST', url: '/api/phone/code', headers: sameSite });
    expect(renew.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/phone' })).json().code).toBe(before);
    const wipe = await app.inject({ method: 'DELETE', url: '/api/data?scope=shots', headers: sameSite });
    expect(wipe.statusCode).toBe(403);
  });

  it('may still read, and the studio itself (same-origin) may still write', async () => {
    const { app } = serve();
    expect((await app.inject({ method: 'GET', url: '/api/brands', headers: sameSite })).statusCode).toBe(200);
    const own = await app.inject({
      method: 'POST',
      url: '/api/phone/code',
      headers: { host: '127.0.0.1:4747', 'sec-fetch-site': 'same-origin' },
    });
    expect(own.statusCode).toBe(200);
  });
});
