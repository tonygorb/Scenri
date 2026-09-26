import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core } from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { CODE_SETTING } from '../src/network/phoneAccess.js';
import { drainTracked, track } from './servers.js';

/**
 * A phone holding the code may use Scenri, but the provider keys are the
 * owner's: a phone could replace one with its own, or clear it (SEC-H8).
 */

let home: string;
let core: Core;
const CODE = '482913';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-settings-'));
  core = createCore(home);
  core.store.setSetting(CODE_SETTING, CODE);
});
afterEach(async () => {
  await drainTracked();
  try {
    core.close();
  } catch {
    // A drained server closes the core on its way out; closing twice throws.
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const serve = () => {
  const demo = createDemoEngine((b) => core.images.save(b));
  return track(
    buildServer({
      core,
      engines: { all: () => [demo], get: (id) => (id === demo.capabilities().id ? demo : null) },
      phone: { addresses: async () => [], listen: async () => ({ close: async () => undefined }) },
    }),
  );
};

describe('PUT /api/settings', () => {
  const fromPhone = (app: ReturnType<typeof serve>, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { host: '192.168.1.20:4747', 'x-access-token': CODE },
      remoteAddress: '192.168.1.50',
      payload,
    });

  it('refuses a provider key from a phone with the code, and changes nothing', async () => {
    const app = serve();
    core.store.setSetting('openrouter_api_key', 'sk-mine');

    const replace = await fromPhone(app, { openrouter_api_key: 'sk-theirs' });
    expect(replace.statusCode).toBe(403);
    expect(replace.json().error).toBe('Only on the computer running Scenri.');
    expect(core.store.getSetting('openrouter_api_key')).toBe('sk-mine');

    // clearing a key is a write too
    expect((await fromPhone(app, { openrouter_api_key: '' })).statusCode).toBe(403);
    expect(core.store.getSetting('openrouter_api_key')).toBe('sk-mine');

    // and a key riding along with a toggle takes the toggle down with it
    expect((await fromPhone(app, { fal_key: 'fal-x', updateCheck: false })).statusCode).toBe(403);
    expect(core.store.getSetting('fal_key')).toBeNull();
    expect(core.store.getSetting('update.enabled')).toBeNull();
  });

  it('still takes the update check from a phone with the code', async () => {
    const app = serve();
    const res = await fromPhone(app, { updateCheck: false });
    expect(res.statusCode).toBe(200);
    expect(core.store.getSetting('update.enabled')).toBe('false');
  });

  it('still takes a key on the computer running Scenri', async () => {
    const app = serve();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { host: '127.0.0.1:4747' },
      payload: { replicate_api_token: 'r8-mine' },
    });
    expect(res.statusCode).toBe(200);
    expect(core.store.getSetting('replicate_api_token')).toBe('r8-mine');
  });
});

describe('PUT /api/caps', () => {
  // A cap is what stands between a runaway loop and the owner's keys, so it is
  // the owner's too: `capUsd: null` would remove it outright.
  const phone = { headers: { host: '192.168.1.20:4747', 'x-access-token': CODE }, remoteAddress: '192.168.1.50' };
  const here = { headers: { host: '127.0.0.1:4747' } };
  const setCap = (app: ReturnType<typeof serve>, capUsd: number | null, from: typeof phone | typeof here) =>
    app.inject({ method: 'PUT', url: '/api/caps', ...from, payload: { engineId: 'openrouter', capUsd } });

  it('refuses a cap from a phone with the code, and keeps the one set', async () => {
    const app = serve();
    core.ledger.setCap('openrouter', 20);
    for (const capUsd of [500, null]) {
      const res = await setCap(app, capUsd, phone);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('Only on the computer running Scenri.');
    }
    expect(core.ledger.capFor('openrouter')).toBe(20);
  });

  it('still takes a cap on the computer running Scenri', async () => {
    const app = serve();
    expect((await setCap(app, 15, here)).statusCode).toBe(200);
    expect(core.ledger.capFor('openrouter')).toBe(15);
    expect((await setCap(app, null, here)).statusCode).toBe(200);
    expect(core.ledger.capFor('openrouter')).toBeNull();
  });
});
