import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { buildServer } from '../src/server.js';
import { createUpdateChecker } from '../src/update/check.js';
import { registerUpdateRoutes } from '../src/routes/updates.js';
import Fastify, { type FastifyInstance } from 'fastify';

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

function registryWith(...adapters: EngineAdapter[]) {
  const byId = new Map(adapters.map((a) => [a.capabilities().id, a]));
  return { all: () => adapters, get: (id: string) => byId.get(id) ?? null };
}

/** Answers the npm dist-tags lookup; nothing else is ever asked for. */
function updateFetch(opts: { latest?: string }) {
  const calls: string[] = [];
  const impl = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/-/package/')) {
      return new Response(JSON.stringify({ latest: opts.latest ?? '0.9.9' }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

let home: string;
let core: Core;
let app: FastifyInstance | null;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-upd-'));
  core = createCore(home);
  app = null;
});
afterEach(async () => {
  await app?.close();
  core.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const build = (fetchImpl: typeof fetch) => buildServer({ core, engines: registryWith(), fetchImpl });

/** Generates forever; settles only when aborted. */
const hangingEngine = (): EngineAdapter => {
  const hang = (signal?: AbortSignal) =>
    new Promise<never>((_res, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  return {
    capabilities: () => ({
      id: 'hang',
      displayName: 'Hang',
      localOnly: false,
      supportsEdit: false,
      supportsMask: false,
      maxReferenceImages: 0,
      placeholder: true,
    }),
    isAvailable: async () => ({ ok: true }),
    costEstimate: async () => 0,
    generate: (_r, s) => hang(s),
    edit: (_r, s) => hang(s),
  };
};

describe('GET /api/update/status', () => {
  it('answers with the full verdict once the registry has been asked', async () => {
    // The fixture is one minor above whatever this build is, so the verdict
    // stays a minor through every release instead of turning into a patch on
    // the day the package reaches the number a fixture used to hardcode.
    const [major, minor] = pkg.version.split('.').map(Number);
    const latest = `${major}.${minor + 1}.0`;
    app = build(updateFetch({ latest }).impl);
    const res = await app.inject({ method: 'GET', url: '/api/update/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      enabled: true,
      current: pkg.version,
      latest,
      available: true,
      kind: 'minor',
      attention: false,
      checkedAt: expect.any(Number),
      notesUrl: `https://github.com/tonygorb/scenri/releases/tag/v${latest}`,
      error: null,
      canApply: false,
      blockReason: 'unsupervised',
      phase: 'idle',
      stagedVersion: null,
    });
  });

  it('flags a major as needing attention', async () => {
    app = build(updateFetch({ latest: '99.0.0' }).impl);
    const res = await app.inject({ method: 'GET', url: '/api/update/status' });
    expect(res.json()).toMatchObject({ kind: 'major', attention: true });
  });

  it('reports not-available when the registry answer is no newer', async () => {
    app = build(updateFetch({ latest: '0.0.0' }).impl);
    const res = await app.inject({ method: 'GET', url: '/api/update/status' });
    expect(res.json()).toMatchObject({ available: false, kind: null, notesUrl: expect.any(String) });
  });

  it('never builds a notes link for a latest that is not a clean release triple', async () => {
    // A mistyped publish can put a prerelease on the latest tag. It must not
    // stage (the triplet guard), and it must not leak into a URL either.
    app = build(updateFetch({ latest: '1.0.0-beta.1' }).impl);
    const res = await app.inject({ method: 'GET', url: '/api/update/status' });
    expect(res.json()).toMatchObject({ available: false, kind: null, notesUrl: null, latest: '1.0.0-beta.1' });
  });
});

describe('POST /api/update/check', () => {
  it('forces a fresh look and returns the same shape', async () => {
    const { impl, calls } = updateFetch({ latest: '0.9.9' });
    app = build(impl);
    await app.inject({ method: 'GET', url: '/api/update/status' });
    const registryCalls = () => calls.filter((u) => u.includes('/-/package/')).length;
    const before = registryCalls();
    const res = await app.inject({ method: 'POST', url: '/api/update/check' });
    expect(res.json()).toMatchObject({ latest: '0.9.9', available: true });
    expect(registryCalls()).toBe(before + 1);
  });
});

describe('one-click apply + restart', () => {
  const supervised = { installKind: 'managed' as const, supervised: true };

  const okStage = async () => ({ ok: true as const, version: '0.9.9', entry: '/staged/entry' });

  it('applies: stages async, then reports ready with the staged version', async () => {
    app = buildServer({
      core,
      engines: registryWith(),
      fetchImpl: updateFetch({ latest: '0.9.9' }).impl,
      runtime: supervised,
      stageImpl: okStage,
    });
    await app.inject({ method: 'GET', url: '/api/update/status' });
    const kicked = await app.inject({ method: 'POST', url: '/api/update/apply' });
    expect(kicked.statusCode).toBe(200);
    for (let i = 0; i < 50; i++) {
      const s = (await app.inject({ method: 'GET', url: '/api/update/status' })).json();
      if (s.phase !== 'staging') {
        expect(s).toMatchObject({ phase: 'ready', stagedVersion: '0.9.9', canApply: true });
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it('refuses to apply while a generation is running', async () => {
    app = buildServer({
      core,
      engines: registryWith(hangingEngine()),
      fetchImpl: updateFetch({ latest: '0.9.9' }).impl,
      runtime: supervised,
      stageImpl: okStage,
    });
    const brand = (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();
    const proj = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } })
    ).json();
    await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: proj.project.id,
        parentId: proj.root.id,
        kind: 'generation',
        prompt: 'x',
        engineId: 'hang',
        width: 256,
        height: 256,
      },
    });

    const refused = await app.inject({ method: 'POST', url: '/api/update/apply' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toContain('running');
    await app.drain();
  });

  it('refuses to apply unsupervised, naming the reason', async () => {
    app = buildServer({ core, engines: registryWith(), fetchImpl: updateFetch({ latest: '0.9.9' }).impl });
    const refused = await app.inject({ method: 'POST', url: '/api/update/apply' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ blockReason: 'unsupervised' });
  });

  it('surfaces a failed staging as phase error with the detail', async () => {
    app = buildServer({
      core,
      engines: registryWith(),
      fetchImpl: updateFetch({ latest: '0.9.9' }).impl,
      runtime: supervised,
      stageImpl: async () => ({ ok: false as const, reason: 'no-npm' as const, detail: 'npm is not reachable' }),
    });
    await app.inject({ method: 'POST', url: '/api/update/apply' });
    for (let i = 0; i < 50; i++) {
      const s = (await app.inject({ method: 'GET', url: '/api/update/status' })).json();
      if (s.phase !== 'staging') {
        expect(s).toMatchObject({ phase: 'error', error: expect.stringContaining('npm') });
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it('restarts only from ready, by draining and exiting 75', async () => {
    const exits: number[] = [];
    app = buildServer({
      core,
      engines: registryWith(),
      fetchImpl: updateFetch({ latest: '0.9.9' }).impl,
      runtime: supervised,
      stageImpl: okStage,
      exitImpl: (code) => exits.push(code),
    });
    const early = await app.inject({ method: 'POST', url: '/api/update/restart' });
    expect(early.statusCode).toBe(409);

    await app.inject({ method: 'POST', url: '/api/update/apply' });
    await new Promise((r) => setTimeout(r, 50));
    const res = await app.inject({ method: 'POST', url: '/api/update/restart' });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(exits).toEqual([75]);
  });
});

describe('auto-stage', () => {
  const supervised = { installKind: 'managed' as const, supervised: true };

  /** Routes on a bare Fastify with an injectable busy count and a fixture registry. */
  function updApp(opts: {
    fixture: { latest?: string };
    stageImpl: NonNullable<Parameters<typeof registerUpdateRoutes>[1]['stageImpl']>;
    busyCount?: () => number;
    bootLookMs?: number;
  }) {
    const a = Fastify();
    const updates = createUpdateChecker({
      name: 'scenri',
      store: core.store,
      fetchImpl: updateFetch(opts.fixture).impl,
      env: {},
      log: () => {},
    });
    registerUpdateRoutes(a, {
      core,
      meta: { name: 'scenri', version: '0.1.0', repository: 'https://github.com/tonygorb/scenri' },
      updates,
      runtime: supervised,
      stageImpl: opts.stageImpl,
      busyCount: opts.busyCount ?? (() => 0),
      bootLookMs: opts.bootLookMs,
    });
    return a;
  }

  const status = async () => (await app!.inject({ method: 'GET', url: '/api/update/status' })).json();
  const untilPhase = async (want: string) => {
    for (let i = 0; i < 100; i++) {
      const s = await status();
      if (s.phase === want) return s;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`phase never became ${want}`);
  };

  it('stages a discovered update in the background, no click needed', async () => {
    const staged: string[] = [];
    app = updApp({
      fixture: { latest: '0.9.9' },
      stageImpl: async (o) => {
        staged.push(o.source.version ?? '');
        return { ok: true, version: '0.9.9', entry: '/e' };
      },
    });
    await status(); // first real registry answer
    const s = await untilPhase('ready');
    expect(s.stagedVersion).toBe('0.9.9');
    expect(staged).toEqual(['0.9.9']);
  });

  it('a forced check answers when checks are off, and stages nothing', async () => {
    let stages = 0;
    core.store.setSetting('update.enabled', 'false');
    app = updApp({
      fixture: { latest: '0.9.9' },
      stageImpl: async () => {
        stages++;
        return { ok: true, version: '0.9.9', entry: '/e' };
      },
    });
    const res = (await app.inject({ method: 'POST', url: '/api/update/check' })).json();
    expect(res).toMatchObject({ enabled: false, latest: '0.9.9', available: true, phase: 'idle' });
    await new Promise((r) => setTimeout(r, 50));
    expect(stages).toBe(0);
  });

  it('waits out running work, then stages at the next real answer', async () => {
    let busy = 1;
    let stages = 0;
    app = updApp({
      fixture: { latest: '0.9.9' },
      stageImpl: async () => {
        stages++;
        return { ok: true, version: '0.9.9', entry: '/e' };
      },
      busyCount: () => busy,
    });
    await status(); // real answer while busy: deferred
    await new Promise((r) => setTimeout(r, 50));
    expect(stages).toBe(0);
    expect((await status()).phase).toBe('idle');
    busy = 0;
    await app.inject({ method: 'POST', url: '/api/update/check' }); // next real answer
    await untilPhase('ready');
    expect(stages).toBe(1);
  });

  it('leaves a failed stage alone until the next real answer, then retries once', async () => {
    let calls = 0;
    app = updApp({
      fixture: { latest: '0.9.9' },
      stageImpl: async () => {
        calls++;
        if (calls === 1) return { ok: false, reason: 'no-npm', detail: 'npm is not reachable' };
        return { ok: true, version: '0.9.9', entry: '/e' };
      },
    });
    await status();
    const failed = await untilPhase('error');
    expect(failed.error).toContain('npm');
    expect(calls).toBe(1);
    await app.inject({ method: 'POST', url: '/api/update/check' });
    await untilPhase('ready');
    expect(calls).toBe(2);
  });

  it('replaces a staged version when something strictly newer appears', async () => {
    const fixture: { latest?: string } = { latest: '0.9.9' };
    const staged: string[] = [];
    app = updApp({
      fixture,
      stageImpl: async (o) => {
        const v = o.source.version ?? '';
        staged.push(v);
        return { ok: true, version: v, entry: '/e' };
      },
    });
    await status();
    await untilPhase('ready');
    fixture.latest = '0.9.10';
    await app.inject({ method: 'POST', url: '/api/update/check' });
    const s = await untilPhase('ready');
    expect(s.stagedVersion).toBe('0.9.10');
    expect(staged).toEqual(['0.9.9', '0.9.10']);
  });

  it('an apply click during in-flight auto-staging of the same version succeeds without a second install', async () => {
    let stages = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    app = updApp({
      fixture: { latest: '0.9.9' },
      stageImpl: async () => {
        stages++;
        await gate;
        return { ok: true, version: '0.9.9', entry: '/e' };
      },
    });
    await app.inject({ method: 'POST', url: '/api/update/check' }); // kicks auto-stage, held open
    expect((await status()).phase).toBe('staging');
    const clicked = await app.inject({ method: 'POST', url: '/api/update/apply' });
    expect(clicked.statusCode).toBe(200);
    release();
    await untilPhase('ready');
    expect(stages).toBe(1);
  });

  it('closing the server disarms the boot look', async () => {
    // Left armed, the deferred look outlives the closed database and
    // detonates as an unhandled rejection; a slow Windows runner found it.
    let stages = 0;
    const a = updApp({
      fixture: { latest: '0.9.9' },
      stageImpl: async () => {
        stages++;
        return { ok: true, version: '0.9.9', entry: '/e' };
      },
      bootLookMs: 30,
    });
    await a.ready();
    await a.close();
    await new Promise((r) => setTimeout(r, 150));
    expect(stages).toBe(0);
  });

  it('refuses to restart over running work', async () => {
    const exits: number[] = [];
    app = buildServer({
      core,
      engines: registryWith(hangingEngine()),
      fetchImpl: updateFetch({ latest: '0.9.9' }).impl,
      runtime: supervised,
      stageImpl: async () => ({ ok: true, version: '0.9.9', entry: '/e' }),
      exitImpl: (code) => exits.push(code),
    });
    await app.inject({ method: 'GET', url: '/api/update/status' });
    await untilPhase('ready'); // staged before any work starts
    const brand = (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();
    const proj = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } })
    ).json();
    await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: proj.project.id,
        parentId: proj.root.id,
        kind: 'generation',
        prompt: 'x',
        engineId: 'hang',
        width: 256,
        height: 256,
      },
    });
    const refused = await app.inject({ method: 'POST', url: '/api/update/restart' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toContain('running');
    expect(exits).toEqual([]);
    await app.drain();
  });
});

describe('settings toggle', () => {
  it('exposes updateCheck as a real boolean and turns the check off', async () => {
    const { impl, calls } = updateFetch({ latest: '0.9.9' });
    app = build(impl);
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).json()).toMatchObject({ updateCheck: true });

    const put = await app.inject({ method: 'PUT', url: '/api/settings', payload: { updateCheck: false } });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).json()).toMatchObject({ updateCheck: false });

    const status = await app.inject({ method: 'GET', url: '/api/update/status' });
    expect(status.json()).toMatchObject({ enabled: false, latest: null });
    expect(calls.filter((u) => u.includes('/-/package/'))).toHaveLength(0);
  });
});
