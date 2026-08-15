import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

function registryWith(...adapters: EngineAdapter[]) {
  const byId = new Map(adapters.map((a) => [a.capabilities().id, a]));
  return { all: () => adapters, get: (id: string) => byId.get(id) ?? null };
}

/** Answers the npm dist-tags lookup and the GitHub release-notes lookup. */
function updateFetch(opts: { latest?: string; ghStatus?: number }) {
  const calls: string[] = [];
  const impl = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/-/package/')) {
      return new Response(JSON.stringify({ latest: opts.latest ?? '0.9.9' }), { status: 200 });
    }
    if (url.includes('api.github.com')) {
      if (opts.ghStatus && opts.ghStatus !== 200) return new Response('{}', { status: opts.ghStatus });
      return new Response(
        JSON.stringify({
          name: `v${opts.latest ?? '0.9.9'}`,
          body: '- 6 new Scenes\n- generation fidelity fixes',
          html_url: `https://github.com/tonygorb/scenri/releases/tag/v${opts.latest ?? '0.9.9'}`,
          published_at: '2026-08-15T00:00:00Z',
        }),
        { status: 200 },
      );
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
  rmSync(home, { recursive: true, force: true });
});

const build = (fetchImpl: typeof fetch) => buildServer({ core, engines: registryWith(), fetchImpl });

describe('GET /api/update/status', () => {
  it('answers with the full verdict once the registry has been asked', async () => {
    app = build(updateFetch({ latest: '0.9.9' }).impl);
    const res = await app.inject({ method: 'GET', url: '/api/update/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      enabled: true,
      current: pkg.version,
      latest: '0.9.9',
      available: true,
      kind: 'minor',
      attention: false,
      checkedAt: expect.any(Number),
      notesUrl: 'https://github.com/tonygorb/scenri/releases/tag/v0.9.9',
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

describe('GET /api/update/notes', () => {
  it('proxies the GitHub release for the latest version', async () => {
    app = build(updateFetch({ latest: '0.9.9' }).impl);
    await app.inject({ method: 'GET', url: '/api/update/status' });
    const res = await app.inject({ method: 'GET', url: '/api/update/notes' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      name: 'v0.9.9',
      body: '- 6 new Scenes\n- generation fidelity fixes',
      url: 'https://github.com/tonygorb/scenri/releases/tag/v0.9.9',
      publishedAt: '2026-08-15T00:00:00Z',
    });
  });

  it('degrades to 502 when GitHub cannot answer, so the UI links out instead', async () => {
    app = build(updateFetch({ latest: '0.9.9', ghStatus: 500 }).impl);
    await app.inject({ method: 'GET', url: '/api/update/status' });
    const res = await app.inject({ method: 'GET', url: '/api/update/notes' });
    expect(res.statusCode).toBe(502);
  });
});

describe('one-click apply + restart', () => {
  const supervised = { installKind: 'managed' as const, supervised: true };

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
