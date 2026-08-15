import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore, SCHEMA_VERSION, type Core, type EngineAdapter } from '@scenri/core';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

function registryWith(...adapters: EngineAdapter[]) {
  const byId = new Map(adapters.map((a) => [a.capabilities().id, a]));
  return { all: () => adapters, get: (id: string) => byId.get(id) ?? null };
}

/** Generates forever; settles only when the drain aborts it. */
function hangingEngine(): EngineAdapter {
  const hang = (signal?: AbortSignal) =>
    new Promise<never>((_resolve, reject) => {
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
    generate: (_req, signal) => hang(signal),
    edit: (_req, signal) => hang(signal),
  };
}

let home: string;
let core: Core;
let app: FastifyInstance;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-ver-'));
  core = createCore(home);
  app = buildServer({ core, engines: registryWith(hangingEngine()) });
});
afterEach(async () => {
  // drain tests already closed both; closing twice must stay harmless
  try {
    await app.close();
    core.close();
  } catch {
    /* already closed */
  }
  rmSync(home, { recursive: true, force: true });
});

describe('detectInstallKind', () => {
  it('recognises a managed install even when the home path travels through a symlink', async () => {
    const { detectInstallKind } = await import('../src/serve.js');
    const { symlinkSync, mkdirSync, realpathSync } = await import('node:fs');
    const real = join(home, 'real-home');
    mkdirSync(join(real, 'app', 'versions', '1.0.0', 'node_modules', 'scenri', 'dist'), { recursive: true });
    const alias = join(home, 'alias-home');
    symlinkSync(real, alias);
    // node reports module paths fully realpathed; the SCENRI_HOME env may be the alias
    const entry = join(realpathSync(real), 'app', 'versions', '1.0.0', 'node_modules', 'scenri', 'dist', 'serve.js');
    expect(detectInstallKind(entry, alias)).toBe('managed');
  });
});

describe('GET /api/version', () => {
  it('reports package identity, schema version and runtime posture', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/version' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      name: 'scenri',
      version: pkg.version,
      schema: SCHEMA_VERSION,
      installKind: 'unknown',
      supervised: false,
      home,
    });
  });

  it('carries the runtime posture serve passes in', async () => {
    const supervised = buildServer({
      core,
      engines: registryWith(),
      runtime: { installKind: 'dev', supervised: true },
    });
    const res = await supervised.inject({ method: 'GET', url: '/api/version' });
    expect(res.json()).toMatchObject({ installKind: 'dev', supervised: true });
    await supervised.close();
  });
});

describe('drain', () => {
  it('aborts in-flight generations, then closes the server and the database', async () => {
    const brand = (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();
    const project = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'camp' } })
    ).json();

    const gen = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: project.project.id,
        parentId: project.root.id,
        kind: 'generation',
        prompt: 'hero',
        engineId: 'hang',
        width: 256,
        height: 256,
      },
    });
    expect(gen.statusCode).toBe(202);
    const nodeId = gen.json().id;

    const running = await app.inject({ method: 'GET', url: `/api/nodes/${nodeId}` });
    expect(running.json().status).toBe('running');

    await app.drain();

    // the drain closed the database; reopen the same home to observe the result
    const reopened = createCore(home);
    expect(reopened.store.getNode(nodeId)?.status).toBe('cancelled');
    reopened.close();
  });

  it('is idempotent', async () => {
    await app.drain();
    await expect(app.drain()).resolves.toBeUndefined();
  });
});
