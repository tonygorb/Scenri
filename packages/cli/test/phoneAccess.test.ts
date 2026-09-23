import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { drainTracked, track } from './servers.js';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_SETTING,
  createPhoneAccess,
  deviceOf,
  newCode,
  normalizeCode,
  type PhoneAccessDeps,
} from '../src/network/phoneAccess.js';

let home: string;
let core: Core;

function registryWith(...adapters: EngineAdapter[]) {
  const byId = new Map(adapters.map((a) => [a.capabilities().id, a]));
  return { all: () => adapters, get: (id: string) => byId.get(id) ?? null };
}

/** A fake listener table: which addresses are open, and a switch to make one refuse. */
let verdict: 'blocked' | 'ok' = 'blocked';
let allowed = 0;
let allowResult: 'done' | 'cancelled' = 'done';

function fakeNet(initial: string[]) {
  let current = initial;
  const open = new Set<string>();
  const refuse = new Set<string>();
  const deps: Omit<PhoneAccessDeps, 'store'> = {
    addresses: async () => current,
    own: () => new Set(['127.0.0.1', '192.168.1.221']),
    firewall: async () => verdict,
    allow: async () => {
      allowed++;
      verdict = 'ok';
      return allowResult;
    },
    platform: 'win32',
    listen: async (address) => {
      if (refuse.has(address)) throw Object.assign(new Error('taken'), { code: 'EADDRINUSE' });
      open.add(address);
      return { close: async () => void open.delete(address) };
    },
  };
  return {
    deps,
    open,
    refuse,
    move: (next: string[]) => {
      current = next;
    },
  };
}

beforeEach(() => {
  verdict = 'blocked';
  allowed = 0;
  allowResult = 'done';
  home = mkdtempSync(join(tmpdir(), 'sc-phone-'));
  core = createCore(home);
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

describe('the code', () => {
  it('is six characters a person can read off a screen', () => {
    for (let i = 0; i < 200; i++) {
      const code = newCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
    expect(CODE_ALPHABET).not.toMatch(/[0O1IL]/);
  });

  it('forgives how it was typed', () => {
    expect(normalizeCode(' k7p-2qx ')).toBe('K7P2QX');
  });

  it('is minted once and kept, so a phone stays signed in across restarts', () => {
    const net = fakeNet([]);
    const first = createPhoneAccess({ store: core.store, ...net.deps }).code;
    expect(core.store.getSetting(CODE_SETTING)).toBe(first);
    expect(createPhoneAccess({ store: core.store, ...net.deps }).code).toBe(first);
  });

  it('replaces a stored value that is not a code', () => {
    core.store.setSetting(CODE_SETTING, 'x');
    const code = createPhoneAccess({ store: core.store, ...fakeNet([]).deps }).code;
    expect(code).toHaveLength(CODE_LENGTH);
  });
});

describe('deviceOf', () => {
  it('names the devices people carry', () => {
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
    expect(deviceOf('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36')).toBe('Android phone');
    expect(deviceOf('Mozilla/5.0 (Linux; Android 15; SM-X910) Safari/537.36')).toBe('Android tablet');
    // iPadOS Safari introduces itself as a Mac
    expect(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15')).toBe('Mac or iPad');
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows computer');
    expect(deviceOf(undefined)).toBe('device');
  });
});

describe('phone listeners', () => {
  it('opens one per address, on the studio port, and reports the best first', async () => {
    const net = fakeNet(['192.168.1.42', '10.0.0.5']);
    const phone = createPhoneAccess({ store: core.store, ...net.deps });
    await phone.start(4750);
    expect([...net.open]).toEqual(['192.168.1.42', '10.0.0.5']);
    const s = await phone.status(true);
    expect(s.address).toBe('http://192.168.1.42:4750');
    expect(s.url).toBe(`http://192.168.1.42:4750/?t=${phone.code}`);
    expect(s.others).toEqual(['http://10.0.0.5:4750']);
    expect(s.problem).toBeNull();
    expect(s.reach).toBe('network');
    await phone.close();
    expect(net.open.size).toBe(0);
  });

  it('follows the machine to another Wi-Fi: the old address closes, the new one opens', async () => {
    const net = fakeNet(['192.168.1.42']);
    const phone = createPhoneAccess({ store: core.store, ...net.deps });
    await phone.start(4747);
    net.move(['10.1.2.3']);
    const s = await phone.status(true);
    expect([...net.open]).toEqual(['10.1.2.3']);
    expect(s.address).toBe('http://10.1.2.3:4747');
    await phone.close();
  });

  it('says there is no network rather than showing an address that cannot open', async () => {
    const phone = createPhoneAccess({ store: core.store, ...fakeNet([]).deps });
    await phone.start(4747);
    const s = await phone.status(true);
    expect(s.address).toBeNull();
    expect(s.url).toBeNull();
    expect(s.problem).toBe('no-network');
    await phone.close();
  });

  it('says blocked when every address refuses, and tries again on the next look', async () => {
    const net = fakeNet(['192.168.1.42']);
    net.refuse.add('192.168.1.42');
    const phone = createPhoneAccess({ store: core.store, ...net.deps });
    await phone.start(4747);
    expect((await phone.status(true)).problem).toBe('blocked');
    net.refuse.clear();
    expect((await phone.status(true)).address).toBe('http://192.168.1.42:4747');
    await phone.close();
  });

  it('opens nothing for this computer only (SCENRI_HOST=127.0.0.1)', async () => {
    const net = fakeNet(['192.168.1.42']);
    const phone = createPhoneAccess({ store: core.store, bind: '127.0.0.1', ...net.deps });
    await phone.start(4747);
    const s = await phone.status(true);
    expect(net.open.size).toBe(0);
    expect(s.reach).toBe('this-computer');
    expect(s.address).toBeNull();
    expect(s.problem).toBeNull();
  });

  it('opens nothing extra when SCENRI_HOST=0.0.0.0 already covers every address', async () => {
    const net = fakeNet(['192.168.1.42']);
    const phone = createPhoneAccess({ store: core.store, bind: '0.0.0.0', ...net.deps });
    await phone.start(4747);
    expect(net.open.size).toBe(0);
    expect((await phone.status(true)).address).toBe('http://192.168.1.42:4747');
  });

  it('shows a SCENRI_HOST given as one address as that address', async () => {
    const phone = createPhoneAccess({ store: core.store, bind: '192.168.7.7', ...fakeNet([]).deps });
    await phone.start(4747);
    expect((await phone.status(true)).address).toBe('http://192.168.7.7:4747');
  });

  it('does not count this computer opening its own link as a phone', () => {
    const phone = createPhoneAccess({ store: core.store, ...fakeNet([]).deps, now: () => 5000 });
    phone.visit('192.168.1.221', 'Mozilla/5.0 (Macintosh)');
    return phone.status(true).then((s) => expect(s.lastVisit).toBeNull());
  });
});

describe('GET /api/phone', () => {
  const serve = (net = fakeNet(['192.168.1.42'])) =>
    track(buildServer({ core, engines: registryWith(createDemoEngine((b) => core.images.save(b))), phone: net.deps }));

  it('answers this computer with the link, the code and who is asking', async () => {
    const app = serve();
    await app.phone.start(4747);
    const s = (await app.inject({ method: 'GET', url: '/api/phone' })).json();
    expect(s.thisComputer).toBe(true);
    expect(s.url).toBe(`http://192.168.1.42:4747/?t=${s.code}`);
    expect(s.platform).toBe('win32');
  });

  it('tells a phone it is not the computer running Scenri', async () => {
    const app = serve();
    await app.phone.start(4747);
    const s = (
      await app.inject({
        method: 'GET',
        url: `/api/phone?t=${app.phone.code}`,
        headers: { host: '192.168.1.42:4747' },
        remoteAddress: '192.168.1.50',
      })
    ).json();
    expect(s.thisComputer).toBe(false);
    expect(s.address).toBe('http://192.168.1.42:4747');
  });

  it('reads the firewall only for this computer', async () => {
    const app = serve();
    await app.phone.start(4747);
    expect((await app.inject({ method: 'GET', url: '/api/phone/help' })).json()).toEqual({ firewall: 'blocked' });
    const remote = await app.inject({
      method: 'GET',
      url: `/api/phone/help?t=${app.phone.code}`,
      headers: { host: '192.168.1.42:4747' },
      remoteAddress: '192.168.1.50',
    });
    expect(remote.json()).toEqual({ firewall: 'unknown' });
  });

  it('Allow asks the OS once, reopens the phone listeners, and answers with a fresh look', async () => {
    const net = fakeNet(['192.168.1.42']);
    const app = serve(net);
    await app.phone.start(4747);
    expect((await app.inject({ method: 'GET', url: '/api/phone/help' })).json().firewall).toBe('blocked');
    const res = await app.inject({ method: 'POST', url: '/api/phone/allow' });
    expect(res.json()).toEqual({ result: 'done', firewall: 'ok' });
    expect(allowed).toBe(1);
    expect(net.open.has('192.168.1.42')).toBe(true);
  });

  it('a declined prompt changes nothing and says so', async () => {
    allowResult = 'cancelled';
    const app = serve();
    await app.phone.start(4747);
    expect((await app.inject({ method: 'POST', url: '/api/phone/allow' })).json().result).toBe('cancelled');
  });

  // the password or UAC prompt would appear on the computer, started by someone else's phone
  it('never lets a phone start the firewall prompt', async () => {
    const app = serve();
    await app.phone.start(4747);
    const res = await app.inject({
      method: 'POST',
      url: `/api/phone/allow?t=${app.phone.code}`,
      headers: { host: '192.168.1.42:4747', 'sec-fetch-site': 'same-origin' },
      remoteAddress: '192.168.1.50',
    });
    expect(res.statusCode).toBe(403);
    expect(allowed).toBe(0);
  });

  it('closes the phone listeners when the server drains', async () => {
    const net = fakeNet(['192.168.1.42']);
    const app = serve(net);
    await app.phone.start(4747);
    expect(net.open.size).toBe(1);
    await app.drain();
    expect(net.open.size).toBe(0);
  });
});
