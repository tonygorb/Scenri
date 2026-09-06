import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core } from '@scenri/core';
import { registerDesktopRoutes } from '../src/routes/desktop.js';
import type { DesktopStatus, InstallResult } from '../src/desktop/install.js';

/**
 * Settings > About talks to these three routes: what the desktop launcher's
 * state is, add or recreate it, and quit Scenri. Everything that touches the
 * machine is injected; the quit route reuses the server's own drain.
 */

let home: string;
let core: Core;
let app: FastifyInstance | null;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-droutes-'));
  core = createCore(home);
  app = null;
});
afterEach(async () => {
  await app?.close();
  core.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const status = (over: Partial<DesktopStatus> = {}): DesktopStatus => ({
  supported: true,
  platform: 'darwin',
  installed: false,
  path: null,
  current: false,
  record: null,
  ...over,
});

function build(opts: {
  installKind?: 'npx' | 'managed' | 'dev';
  statusImpl?: () => Promise<DesktopStatus>;
  installImpl?: () => Promise<InstallResult>;
  busy?: number;
}) {
  const a = Fastify();
  const exits: number[] = [];
  let drained = 0;
  a.decorate('drain', async () => {
    drained++;
  });
  const installs = { count: 0 };
  registerDesktopRoutes(a, {
    core,
    runtime: { installKind: opts.installKind ?? 'managed', supervised: true },
    busyCount: () => opts.busy ?? 0,
    exitImpl: (code) => exits.push(code),
    statusImpl: opts.statusImpl ?? (async () => status()),
    installImpl:
      opts.installImpl ??
      (async () => {
        installs.count++;
        return { ok: true, kind: 'macos-app', path: '/Users/t/Desktop/Scenri.app' };
      }),
  });
  app = a;
  return { a, exits, installs, drainedCount: () => drained };
}

describe('GET /api/desktop', () => {
  it('reports the launcher state, the install posture and an earlier Not now', async () => {
    const { a } = build({ statusImpl: async () => status({ installed: true, path: '/Users/t/Desktop/Scenri.app' }) });
    let res = await a.inject({ method: 'GET', url: '/api/desktop' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      supported: true,
      platform: 'darwin',
      installed: true,
      path: '/Users/t/Desktop/Scenri.app',
      declined: false,
      installKind: 'managed',
    });
    core.store.setSetting('desktop.prompt', 'declined');
    res = await a.inject({ method: 'GET', url: '/api/desktop' });
    expect(res.json().declined).toBe(true);
  });
});

describe('POST /api/desktop/install', () => {
  it('adds or recreates the launcher and answers with where it went', async () => {
    const { a, installs } = build({});
    const res = await a.inject({ method: 'POST', url: '/api/desktop/install' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, path: '/Users/t/Desktop/Scenri.app' });
    expect(installs.count).toBe(1);
  });

  it('passes a refusal through as a 409 with the sentence About shows', async () => {
    const { a } = build({
      installImpl: async () => ({
        ok: false,
        reason: 'collision',
        message: 'Something else named Scenri is already on your desktop. Move or rename it, then try again.',
      }),
    });
    const res = await a.inject({ method: 'POST', url: '/api/desktop/install' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'Something else named Scenri is already on your desktop. Move or rename it, then try again.',
      reason: 'collision',
    });
  });

  it('refuses from a source checkout without touching anything', async () => {
    const { a, installs } = build({ installKind: 'dev' });
    const res = await a.inject({ method: 'POST', url: '/api/desktop/install' });
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe('dev');
    expect(installs.count).toBe(0);
  });
});

describe('POST /api/system/quit', () => {
  it('never quits over live work', async () => {
    const { a, exits } = build({ busy: 2 });
    const res = await a.inject({ method: 'POST', url: '/api/system/quit' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'work is still running (2 tasks)' });
    expect(exits).toEqual([]);
  });

  it('answers first, then drains and exits cleanly', async () => {
    const { a, exits, drainedCount } = build({});
    const res = await a.inject({ method: 'POST', url: '/api/system/quit' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    for (let i = 0; i < 40 && exits.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
    expect(drainedCount()).toBe(1);
    expect(exits).toEqual([0]);
  });
});
