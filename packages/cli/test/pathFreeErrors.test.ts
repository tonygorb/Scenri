/**
 * A failure a person reads never names a path on this machine. The codex engine
 * runs on a runner that can never start codex, so a reference picture that
 * cannot be read fails before anything is sent, and what the draft or the
 * studio job says about it is checked for the library, a temp folder or a home
 * folder.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { createCodexEngine, type CodexRunner } from '@scenri/engine-codex';
import { buildServer } from '../src/server.js';
import { resetAssetBuilds } from '../src/customAssets.js';
import { resetPresenterDrafts } from '../src/presenterDrafts.js';
import { resetSceneStudio } from '../src/sceneStudio.js';
import { drainTracked, track } from './servers.js';

let home: string;
let templatesDir: string;
let core: Core;

beforeEach(() => {
  resetAssetBuilds();
  resetPresenterDrafts();
  resetSceneStudio();
  templatesDir = mkdtempSync(join(tmpdir(), 'sc-pathfree-tpl-'));
  mkdirSync(join(templatesDir, 'presenters'), { recursive: true });
  home = mkdtempSync(join(tmpdir(), 'sc-pathfree-home-'));
  core = createCore(home);
});

afterEach(async () => {
  resetPresenterDrafts();
  resetSceneStudio();
  resetAssetBuilds();
  await drainTracked();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(templatesDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const png = (n: number, w = 64, h = 80) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: n % 256, g: (n * 7) % 256, b: 90 } } })
    .png()
    .toBuffer();

/** The real codex engine on a runner that can never start codex. */
function codexEngine(): EngineAdapter {
  const runner = {
    run: async () => {
      throw new Error('codex must never run in this test');
    },
    withWorkDir: async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
      const dir = mkdtempSync(join(tmpdir(), 'scenri-codex-'));
      try {
        return await fn(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    probe: async () => ({ ok: true }),
    invalidateProbe: () => {},
    connect: async () => ({}) as any,
    invalidateConnection: () => {},
    noteConnection: () => {},
  } as unknown as CodexRunner;
  return createCodexEngine({ saveImage: (b) => core.images.save(b), runner });
}

function server(engine: EngineAdapter, analyzer?: any) {
  const app = track(
    buildServer({
      core,
      engines: { all: () => [engine], get: (id) => (id === engine.capabilities().id ? engine : null) },
      templatesDir,
      analyzer: analyzer ?? {
        isAvailable: async () => ({ ok: false, reason: 'off' }),
        analyze: async () => ({}) as any,
      },
      sizeReader: null,
    }),
  );
  const j = async (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) } as any);
    return { status: res.statusCode, body: res.json() as any, raw: res.body };
  };
  return { app, j };
}

const wait = async (cond: () => Promise<boolean>, what: string) => {
  for (const until = Date.now() + 15_000; Date.now() < until; ) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
};

/** An absolute path of this machine: the library, a temp dir, a home folder. */
const leaksPath = (text: string) =>
  text.includes(home) || text.includes(tmpdir()) || /\/(Users|home|private|var|tmp)\/[^\s'"]+/.test(text);

describe('a reference picture that cannot be read', { timeout: 30_000 }, () => {
  it('fails a presenter view in words that name no path on this machine (SEC-H3)', async () => {
    const { j } = server(codexEngine());
    const brandId = (await j('POST', '/api/brands', { brand: { specVersion: '0.1', meta: { name: 'Acme' } } })).body.id;
    const face = core.images.save(await png(2, 200, 250));
    const base = `/api/brands/${brandId}/presenter-drafts`;
    const made = await j('POST', base, { source: 'photos', imageHashes: [face], attestation: true });
    expect(made.status, made.raw).toBe(200);
    const id = made.body.id as string;
    await wait(async () => (await j('GET', `${base}/${id}`)).body.stage !== 'analyzing', 'the photo read');
    // the photo went away underneath the draft (a discard elsewhere, a cleaned folder)
    rmSync(core.images.pathFor(face));
    expect((await j('POST', `${base}/${id}/views/portrait/generate`, {})).status).toBe(200);
    let got: { body: any; raw: string } = { body: null, raw: '' };
    await wait(async () => {
      got = await j('GET', `${base}/${id}`);
      return got.body.views.portrait.status !== 'generating';
    }, 'the failed draw');
    const error = String(got.body.views.portrait.error ?? '');
    expect(error).toBeTruthy();
    expect(leaksPath(got.raw)).toBe(false);
  });

  // an unreadable file is made with chmod, which neither Windows nor root obeys
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'fails a scene studio job in words that name no path on this machine (SEC-H3)',
    async () => {
      const { j } = server(codexEngine());
      const brandId = (await j('POST', '/api/brands', { brand: { specVersion: '0.1', meta: { name: 'Acme' } } })).body
        .id;
      const room = core.images.save(await png(3, 200, 250));
      const file = core.images.pathFor(room);
      chmodSync(file, 0o000);
      try {
        const url = `/api/brands/${brandId}/scene-studio/jobs`;
        const started = await j('POST', url, {
          kind: 'make',
          instruction: 'A sunlit loft kitchen with a long oak table',
          imageHashes: [room],
        });
        expect(started.status, started.raw).toBe(200);
        let got: { body: any; raw: string } = { body: null, raw: '' };
        await wait(async () => {
          got = await j('GET', `${url}/${started.body.jobId}`);
          return got.body.status !== 'running';
        }, 'the studio job');
        expect(got.body.status).toBe('failed');
        expect(leaksPath(got.raw)).toBe(false);
      } finally {
        chmodSync(file, 0o600);
      }
    },
  );
});
