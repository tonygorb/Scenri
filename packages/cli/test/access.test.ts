import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { drainTracked, track } from './servers.js';
import { hostnameOf, isIPv4Literal, ACCESS_COOKIE } from '../src/access.js';
import { CODE_SETTING } from '../src/network/phoneAccess.js';
import type { FastifyInstance } from 'fastify';

let home: string;
let core: Core;
const CODE = '482913';

function registryWith(...adapters: EngineAdapter[]) {
  const byId = new Map(adapters.map((a) => [a.capabilities().id, a]));
  return { all: () => adapters, get: (id: string) => byId.get(id) ?? null };
}

const serve = (extra: Partial<Parameters<typeof buildServer>[0]> = {}) =>
  track(
    buildServer({
      core,
      engines: registryWith(createDemoEngine((b) => core.images.save(b))),
      // no phone listener and no network probe in a unit test
      phone: { addresses: async () => [], listen: async () => ({ close: async () => undefined }) },
      ...extra,
    }),
  );

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-access-'));
  core = createCore(home);
  core.store.setSetting(CODE_SETTING, CODE);
});
afterEach(async () => {
  // Drain rather than close, and every server rather than the one a variable
  // happens to hold: the demo engine saves images, so a thumbnail write can
  // outlive the test body and the home it writes into.
  await drainTracked();
  try {
    core.close();
  } catch {
    // A drained server closes the core on its way out; closing twice throws.
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('hostnameOf', () => {
  it('strips the port', () => {
    expect(hostnameOf('127.0.0.1:4747')).toBe('127.0.0.1');
    expect(hostnameOf('localhost:4747')).toBe('localhost');
  });
  it('keeps a bare hostname', () => {
    expect(hostnameOf('localhost')).toBe('localhost');
  });
  it('unwraps bracketed IPv6', () => {
    expect(hostnameOf('[::1]:4747')).toBe('::1');
  });
  it('lowercases', () => {
    expect(hostnameOf('EVIL.Example:80')).toBe('evil.example');
  });
  it('returns null for nothing usable', () => {
    expect(hostnameOf(undefined)).toBeNull();
    expect(hostnameOf('   ')).toBeNull();
    expect(hostnameOf('[::1')).toBeNull();
  });
});

describe('host allowlist', () => {
  let app: FastifyInstance;

  it('allows loopback names by default', async () => {
    app = serve();
    for (const host of ['127.0.0.1:4747', 'localhost:4747', '[::1]:4747']) {
      const res = await app.inject({ method: 'GET', url: '/api/brands', headers: { host } });
      expect(res.statusCode, host).toBe(200);
    }
  });

  it('rejects a foreign Host header, which is how DNS rebinding arrives', async () => {
    app = serve();
    const res = await app.inject({ method: 'GET', url: '/api/brands', headers: { host: 'evil.example:4747' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('forbidden host');
  });

  it('rejects 0.0.0.0, which browsers will load but the user never recognises', async () => {
    app = serve();
    const res = await app.inject({ method: 'GET', url: '/api/brands', headers: { host: '0.0.0.0:4747' } });
    expect(res.statusCode).toBe(403);
  });

  // A missing Host is covered by the hostnameOf unit tests above: inject always
  // substitutes its own default, and Node answers a HTTP/1.1 request with no
  // Host header itself, before Fastify sees it.

  it('passes any IPv4 address on to the code, whichever Wi-Fi this is', async () => {
    app = serve();
    for (const host of ['192.168.1.20:4747', '10.0.0.5:4747', '172.20.10.2:4747']) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/brands',
        headers: { host },
        remoteAddress: '192.168.1.50',
      });
      expect(res.statusCode, host).toBe(403);
      expect(res.json().error, host).toBe('access code required');
    }
  });

  it('accepts a SCENRI_HOST given as a name', async () => {
    app = serve({ access: { allowedHosts: ['studio.local'] } });
    const res = await app.inject({
      method: 'GET',
      url: `/api/brands?t=${CODE}`,
      headers: { host: 'studio.local:4747' },
      remoteAddress: '192.168.1.50',
    });
    expect(res.statusCode).toBe(200);
  });

  it('guards the SPA fallback too, not just /api', async () => {
    app = serve();
    const res = await app.inject({ method: 'GET', url: '/', headers: { host: 'evil.example' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('cross-site request blocking', () => {
  let app: FastifyInstance;

  // The CSRF shape: a page on another origin firing a body-less POST at the
  // loopback port. No content-type means no preflight, and the Host header is
  // one we trust, so Sec-Fetch-Site is the only thing that names the caller.
  it('rejects a cross-site POST, which is how drive-by CSRF arrives', async () => {
    app = serve();
    const res = await app.inject({
      method: 'POST',
      url: '/api/update/check',
      headers: { host: '127.0.0.1:4747', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('cross-site request blocked');
  });

  it('rejects a cross-site GET that is not a navigation', async () => {
    app = serve();
    const res = await app.inject({
      method: 'GET',
      url: '/api/brands',
      headers: { host: '127.0.0.1:4747', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' },
    });
    expect(res.statusCode).toBe(403);
  });

  // the one legitimate cross-site shape: the user clicking a link to their studio
  it('allows a cross-site top-level navigation', async () => {
    app = serve();
    const res = await app.inject({
      method: 'GET',
      url: '/api/brands',
      headers: { host: '127.0.0.1:4747', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows the SPA itself: same-origin fetches carry same-origin', async () => {
    app = serve();
    const res = await app.inject({
      method: 'POST',
      url: '/api/update/check',
      headers: { host: '127.0.0.1:4747', 'sec-fetch-site': 'same-origin' },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('leaves non-browser clients alone: no Sec-Fetch headers, no gate', async () => {
    app = serve();
    const res = await app.inject({
      method: 'POST',
      url: '/api/update/check',
      headers: { host: '127.0.0.1:4747' },
    });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('what every answer carries', () => {
  let app: FastifyInstance;
  let dist: string;
  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'sc-dist-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Scenri</title>');
    writeFileSync(join(dist, 'mark.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
  afterEach(() => rmSync(dist, { recursive: true, force: true }));

  // No page may frame the studio (a click on Shut down under someone else's
  // page), and no answer may be read as a type other than the one it names.
  it('forbids framing and sniffing on the API, a refusal, the code page and the studio', async () => {
    app = serve({ studioDist: dist });
    const phone = { host: '192.168.1.20:4747', accept: 'text/html' };
    const answers = {
      api: await app.inject({ method: 'GET', url: '/api/brands' }),
      refused: await app.inject({ method: 'GET', url: '/api/brands', headers: { host: 'evil.example' } }),
      codePage: await app.inject({ method: 'GET', url: '/create', headers: phone, remoteAddress: '192.168.1.50' }),
      studio: await app.inject({ method: 'GET', url: '/create', headers: { accept: 'text/html' } }),
      file: await app.inject({ method: 'GET', url: '/mark.png' }),
    };
    expect(Object.values(answers).map((r) => r.statusCode)).toEqual([200, 403, 403, 200, 200]);
    for (const [kind, res] of Object.entries(answers)) {
      expect(res.headers['x-content-type-options'], kind).toBe('nosniff');
      expect(res.headers['x-frame-options'], kind).toBe('DENY');
      expect(res.headers['content-security-policy'], kind).toBe("frame-ancestors 'none'");
    }
  });
});

describe('isIPv4Literal', () => {
  it('knows an address from a name', () => {
    expect(isIPv4Literal('192.168.1.20')).toBe(true);
    expect(isIPv4Literal('10.0.0.255')).toBe(true);
    expect(isIPv4Literal('0.0.0.0')).toBe(false);
    expect(isIPv4Literal('192.168.1.256')).toBe(false);
    expect(isIPv4Literal('192.168.1')).toBe(false);
    expect(isIPv4Literal('1.2.3.4.evil.example')).toBe(false);
    expect(isIPv4Literal('evil.example')).toBe(false);
  });
});

describe('the code another device brings', () => {
  let app: FastifyInstance;
  beforeEach(() => {
    app = serve();
  });

  const phone = (extra: Record<string, string> = {}) => ({ host: '192.168.1.20:4747', ...extra });
  const from = '192.168.1.50';
  const get = (url: string, headers: Record<string, string> = {}, remoteAddress = from) =>
    app.inject({ method: 'GET', url, headers: phone(headers), remoteAddress });

  it('refuses the API without the code', async () => {
    const res = await get('/api/brands');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('access code required');
  });

  it('shows a page that asks for the code when a browser opens the bare address', async () => {
    const res = await get('/', { 'sec-fetch-mode': 'navigate', accept: 'text/html' });
    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Enter your code');
    expect(res.body).toContain('autocomplete="one-time-code"');
    expect(res.body).toContain('name="t"');
    // nothing went wrong yet: the message line is there, and empty
    expect(res.body).toContain('<p class="msg" id="msg" role="alert"></p>');
  });

  it('says so when the typed code is wrong', async () => {
    const res = await get('/?t=000000', { accept: 'text/html' });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("That code didn't work");
    // the page's own quiet check hears which it was
    const api = await get('/api/phone?t=000000');
    expect(api.json()).toEqual({ error: 'wrong code' });
  });

  it('accepts the code in the link and hands back a lasting cookie', async () => {
    const res = await get(`/api/brands?t=${CODE}`);
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`${ACCESS_COOKIE}=${CODE}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=34560000');
  });

  it('forgives case, spaces and dashes in a typed code', async () => {
    for (const typed of ['482 913', '482-913', ' 482913 ']) {
      const res = await get(`/api/brands?t=${encodeURIComponent(typed)}`);
      expect(res.statusCode, typed).toBe(200);
    }
  });

  it('accepts the cookie on later requests, so the code leaves the address bar', async () => {
    expect((await get('/api/brands', { cookie: `${ACCESS_COOKIE}=${CODE}` })).statusCode).toBe(200);
  });

  it('accepts the pre-rename bt_access cookie, never with a wrong value', async () => {
    expect((await get('/api/brands', { cookie: `bt_access=${CODE}` })).statusCode).toBe(200);
    expect((await get('/api/brands', { cookie: 'bt_access=nope' })).statusCode).toBe(403);
  });

  it('accepts an x-access-token header', async () => {
    expect((await get('/api/brands', { 'x-access-token': CODE })).statusCode).toBe(200);
  });

  it('names the cookie for the port, so two Scenris on one machine never overwrite each other', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const res = await get(`/api/brands?t=${CODE}`);
    expect(String(res.headers['set-cookie'])).toContain(`${ACCESS_COOKIE}_${port}=${CODE}`);
    expect((await get('/api/brands', { cookie: `${ACCESS_COOKIE}_${port}=${CODE}` })).statusCode).toBe(200);
  });

  // the desktop icon's probe, the adopt probe and the tab this computer opens
  it('never asks this computer for the code', async () => {
    for (const host of ['127.0.0.1:4747', 'localhost:4747', '[::1]:4747']) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/brands',
        headers: { host },
        remoteAddress: '127.0.0.1',
      });
      expect(res.statusCode, host).toBe(200);
    }
  });

  // Vite --host turns a phone into a loopback connection that still names the Wi-Fi address
  it('asks a phone that arrives through a local proxy', async () => {
    const res = await get('/api/brands', {}, '127.0.0.1');
    expect(res.statusCode).toBe(403);
  });

  it('asks a device on the network that claims to be localhost', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/brands',
      headers: { host: 'localhost:4747' },
      remoteAddress: from,
    });
    expect(res.statusCode).toBe(403);
  });

  it('checks the host before the code, so a foreign host cannot guess', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/brands?t=${CODE}`,
      headers: { host: 'evil.example' },
      remoteAddress: from,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('forbidden host');
  });

  it('notes the device that got in, for Settings to say it worked', async () => {
    await get(`/api/brands?t=${CODE}`, {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    });
    const status = (await app.inject({ method: 'GET', url: '/api/phone' })).json();
    expect(status.lastVisit.device).toBe('iPhone');
  });
});

describe('guessing the code', () => {
  const from = '192.168.1.66';
  let clock = 1_000_000;
  let app: FastifyInstance;
  beforeEach(() => {
    clock = 1_000_000;
    app = serve({ access: { now: () => clock } });
  });
  const tryCode = (code: string, remoteAddress = from, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'GET',
      url: `/api/brands?t=${code}`,
      headers: { host: '192.168.1.20:4747', ...headers },
      remoteAddress,
    });

  it('stops an address after ten different wrong codes, the right one included', async () => {
    for (let i = 0; i < 10; i++) expect((await tryCode(`WRONG${i}`)).statusCode).toBe(403);
    const locked = await tryCode(CODE);
    expect(locked.statusCode).toBe(403);
    expect(locked.json().error).toBe('too many tries');
    const page = await tryCode(CODE, from, { accept: 'text/html' });
    expect(page.body).toContain('Too many tries');
  });

  it('leaves every other address alone', async () => {
    for (let i = 0; i < 10; i++) await tryCode(`WRONG${i}`);
    expect((await tryCode(CODE, '192.168.1.67')).statusCode).toBe(200);
  });

  it('lets the address try again ten minutes later', async () => {
    for (let i = 0; i < 10; i++) await tryCode(`WRONG${i}`);
    clock += 10 * 60_000 + 1;
    expect((await tryCode(CODE)).statusCode).toBe(200);
  });

  // many addresses (IPv6, aliases, a big network) must not add up to fast guessing
  it('a hundred different wrong codes from every address together makes every device wait', async () => {
    for (let i = 0; i < 100; i++) {
      // ten addresses, ten tries each: none reaches its own limit
      await tryCode(`9${String(i).padStart(5, '0')}`, `192.168.2.${Math.floor(i / 10) + 1}`);
    }
    const fresh = await tryCode(CODE, '192.168.3.99');
    expect(fresh.statusCode).toBe(403);
    expect(fresh.json().error).toBe('too many tries');
    // this computer is never affected
    const host = await app.inject({ method: 'GET', url: '/api/brands', remoteAddress: '127.0.0.1' });
    expect(host.statusCode).toBe(200);
    clock += 10 * 60_000 + 1;
    expect((await tryCode(CODE, '192.168.3.99')).statusCode).toBe(200);
  });

  it('a device already signed in stays in, whatever an old or mistyped link says', async () => {
    const res = await tryCode('000000', from, { cookie: `${ACCESS_COOKIE}=${CODE}` });
    expect(res.statusCode).toBe(200);
    // and the bad link did not count against it
    for (let i = 0; i < 12; i++) await tryCode(`00000${i % 10}`, from, { cookie: `${ACCESS_COOKIE}=${CODE}` });
    expect((await tryCode(CODE)).statusCode).toBe(200);
  });

  // a phone polling with a cookie from before a reset repeats one value
  it('counts one stale value once, however often it arrives', async () => {
    for (let i = 0; i < 40; i++) {
      await app.inject({
        method: 'GET',
        url: '/api/brands',
        headers: { host: '192.168.1.20:4747', cookie: `${ACCESS_COOKIE}=OLDOLD` },
        remoteAddress: from,
      });
    }
    expect((await tryCode(CODE)).statusCode).toBe(200);
  });
});
