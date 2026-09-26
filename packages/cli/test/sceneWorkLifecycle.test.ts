import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { createDemoAnalyzer, createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { resetAssetBuilds, runningAssetBuildCount } from '../src/customAssets.js';
import { resetSceneStudio } from '../src/sceneStudio.js';
import { drainTracked, track } from './servers.js';

/**
 * Scene work on the server from start to end: a studio job that a delete, a
 * Stop or an empty answer cuts short, what it leaves on disk, how long a
 * finished job is kept, and the reads (asset builds) a scene is made or read
 * again with. The engine is the demo engine, spied: a held call waits for
 * `open()` and rejects on abort, the way a killed codex child answers nothing.
 */

let home: string;
let templatesDir: string;
let core: Core;
const env = process.env.SCENRI_DEMO_BUILDS;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-scenework-'));
  templatesDir = mkdtempSync(join(tmpdir(), 'sc-scenework-templates-'));
  core = createCore(home);
  resetSceneStudio();
  resetAssetBuilds();
  process.env.SCENRI_DEMO_BUILDS = '1';
});
afterEach(async () => {
  resetAssetBuilds();
  await drainTracked();
  resetSceneStudio();
  try {
    core.close();
  } catch {
    // a drained server closes the core on its way out
  }
  if (env === undefined) delete process.env.SCENRI_DEMO_BUILDS;
  else process.env.SCENRI_DEMO_BUILDS = env;
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(templatesDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const png = (shade: number) =>
  sharp({ create: { width: 64, height: 80, channels: 3, background: { r: shade, g: shade, b: shade } } })
    .png()
    .toBuffer();

const tint = (r: number, b: number) =>
  sharp({ create: { width: 64, height: 80, channels: 3, background: { r, g: 90, b } } })
    .png()
    .toBuffer();

const READ = {
  name: 'Edit Hall',
  prompt: 'A raw concrete hall with a low plinth, soft window light from the left.',
  lighting: 'Soft window light',
  subject: 'product',
  description: 'A raw concrete hall.',
};

const wait = async (cond: () => boolean | Promise<boolean>, what: string) => {
  for (const until = Date.now() + 20_000; Date.now() < until; ) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
};

function spied() {
  const demo = createDemoEngine((b: Buffer) => core.images.save(b), { maxReferenceImages: 4 });
  const calls = { generate: [] as any[], edit: [] as any[] };
  /** Every picture the engine handed back. */
  const produced = new Set<string>();
  const ctl = {
    holdGenerate: null as null | ((n: number) => boolean),
    holdEdit: null as null | ((n: number) => boolean),
    /** Answer the nth generate with no picture at all. */
    emptyGenerate: null as null | ((n: number) => boolean),
    openers: [] as (() => void)[],
    open() {
      for (const o of ctl.openers.splice(0)) o();
    },
  };
  const hold = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      ctl.openers.push(resolve);
      signal?.addEventListener('abort', () => reject(new Error('cancelled')));
    });
  const engine: EngineAdapter = {
    ...demo,
    capabilities: () => demo.capabilities(),
    costEstimate: async () => 0,
    generate: async (req, signal, onImage) => {
      calls.generate.push(req);
      const n = calls.generate.length;
      if (ctl.holdGenerate?.(n)) await hold(signal);
      if (signal?.aborted) throw new Error('generation cancelled');
      if (ctl.emptyGenerate?.(n)) return { images: [], costUsd: 0 };
      // the demo engine answers the same draw with the same bytes; a real one never does
      const images: string[] = [];
      for (let i = 0; i < Math.max(1, req.count); i++) {
        const hash = core.images.save(await tint((n * 37) % 256, (n * 11 + i * 5) % 256));
        produced.add(hash);
        images.push(hash);
        onImage?.(i, hash);
      }
      return { images, costUsd: 0 };
    },
    edit: async (req, signal) => {
      calls.edit.push(req);
      const n = calls.edit.length;
      if (ctl.holdEdit?.(n)) await hold(signal);
      await demo.edit(req, signal);
      const hash = core.images.save(await png(20 + ((n * 9) % 200)));
      produced.add(hash);
      return { images: [hash], costUsd: 0 };
    },
  };
  return { engine, calls, ctl, produced };
}

async function setup(opts: { analyzer?: any } = {}) {
  mkdirSync(join(templatesDir, 'demo-products'), { recursive: true });
  writeFileSync(
    join(templatesDir, 'demo-products', 'vial.json'),
    JSON.stringify({
      id: 'vial',
      name: 'Vial',
      promptName: 'a glass perfume vial',
      category: 'fragrance',
      description: 'A glass perfume vial.',
      width: 10,
      height: 10,
    }),
  );
  const refDir = join(templatesDir, 'previews', 'demo-products', 'vial');
  mkdirSync(refDir, { recursive: true });
  writeFileSync(
    join(refDir, 'three-quarter.jpg'),
    await sharp(await png(40))
      .jpeg()
      .toBuffer(),
  );
  const spy = spied();
  const app = track(
    buildServer({
      core,
      engines: { all: () => [spy.engine], get: (id: string) => (id === 'demo' ? spy.engine : null) },
      sizeReader: createDemoAnalyzer(),
      analyzer: opts.analyzer ?? createDemoAnalyzer(),
      templatesDir,
    }),
  );
  const brand = (
    await app.inject({
      method: 'POST',
      url: '/api/brands',
      payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
    })
  ).json();
  const brandId = brand.id as string;
  const studioUrl = `/api/brands/${brandId}/scene-studio/jobs`;
  const sceneOf = (id: string) =>
    ((core.store.getBrand(brandId)?.json as any)?.scenes ?? []).find((s: any) => s.id === id);
  const saveScene = async (payload: Record<string, unknown>) => {
    const res = await app.inject({ method: 'POST', url: `/api/brands/${brandId}/scenes`, payload });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().scene;
  };
  const start = async (payload: Record<string, unknown>) => {
    const res = await app.inject({ method: 'POST', url: studioUrl, payload: { kind: 'make', ...payload } });
    if (res.statusCode !== 200) throw new Error(res.body);
    return res.json().jobId as string;
  };
  const job = async (jobId: string) => (await app.inject({ method: 'GET', url: `${studioUrl}/${jobId}` })).json();
  const settle = async (jobId: string) => {
    let last: any;
    await wait(async () => {
      last = await job(jobId);
      return last.status !== 'running';
    }, 'the studio job');
    return last;
  };
  const studio = async (payload: Record<string, unknown>) => settle(await start(payload));
  const build = async (jobId: string) => {
    let last: any;
    await wait(async () => {
      last = (await app.inject({ method: 'GET', url: `/api/brands/${brandId}/asset-builds/${jobId}` })).json();
      return last.finished;
    }, 'the build');
    return last;
  };
  return { app, brandId, studioUrl, sceneOf, saveScene, start, job, settle, studio, build, ...spy };
}

describe('a studio job', { timeout: 60_000 }, () => {
  // make, Try again three times, Stop, Use, delete. What the conversation can still
  // point at (its versions' place and hero, the picture it was given) may stay;
  // anything else the engine drew is a file nothing can ever reach.
  it('leaves no picture on disk that nothing can point at (SS-H9)', async () => {
    const s = await setup();
    const photo = core.images.save(await png(123));
    const held = new Set<string>([photo]);
    const orphans = () => [...s.produced].filter((h) => core.images.has(h) && !held.has(h));
    const words = 'A raw concrete hall, someone holding the product';

    const made = await s.studio({ instruction: words, imageHashes: [photo], conversation: 'c9' });
    expect(made.status).toBe('done');
    expect(made.hero).toBeTruthy();
    held.add(made.hash);
    held.add(made.hero);
    let last = made;
    for (let i = 1; i <= 3; i++) {
      last = await s.studio({ kind: 'again', reading: made.reading, imageHashes: [photo], conversation: 'c9' });
      expect(last.status).toBe('done');
      held.add(last.hash);
      held.add(last.hero);
    }
    // Stop, once the first picture has landed and the scrub is drawing
    const target = s.calls.edit.length + 1;
    s.ctl.holdEdit = (n) => n === target;
    const stopped = await s.start({ kind: 'again', reading: made.reading, imageHashes: [photo], conversation: 'c9' });
    await wait(() => s.calls.edit.length === target, 'the held scrub');
    await s.app.inject({ method: 'POST', url: `${s.studioUrl}/${stopped}/cancel` });
    expect((await s.settle(stopped)).status).toBe('cancelled');
    // Use the last version, then delete the scene
    const saved = await s.saveScene({
      ...last.reading,
      previewHash: last.hash,
      anchor: last.anchor,
      heroHash: last.hero,
      heroWith: last.heroWith,
      refHashes: [photo],
    });
    await s.app.inject({ method: 'DELETE', url: `/api/brands/${s.brandId}/scenes/${saved.id}` });
    expect(orphans()).toEqual([]);
  });

  it('is stopped by deleting the scene it was going to land on, and spends nothing more (SS-H11)', async () => {
    const s = await setup();
    s.ctl.holdGenerate = (n) => n === 1;
    const jobId = await s.start({ instruction: 'A raw concrete hall with a low plinth', conversation: 'c11' });
    await wait(() => s.calls.generate.length === 1, 'the held place draw');
    const saved = await s.saveScene({ name: 'Hall', prompt: 'A raw concrete hall with a low plinth.' });
    const attach = await s.app.inject({
      method: 'POST',
      url: `${s.studioUrl}/${jobId}/attach`,
      payload: { sceneId: saved.id },
    });
    expect(attach.json().state).toBe('pending');
    expect(
      (await s.app.inject({ method: 'DELETE', url: `/api/brands/${s.brandId}/scenes/${saved.id}` })).statusCode,
    ).toBe(200);
    const spentAtDelete = s.calls.generate.length + s.calls.edit.length;
    s.ctl.open();
    const job = await s.settle(jobId);
    expect(job.status).toBe('cancelled');
    expect(s.calls.generate.length + s.calls.edit.length).toBe(spentAtDelete);
  });

  it('is stopped by deleting the scene its edit studio is redrawing (OP-H4)', async () => {
    const s = await setup();
    const saved = await s.saveScene({ name: 'Edit Hall', prompt: READ.prompt });
    s.ctl.holdGenerate = () => true;
    const jobId = await s.start({
      kind: 'again',
      reading: READ,
      conversation: 'c-edit',
      sceneId: saved.id,
      label: 'Edit Hall',
    });
    await wait(() => s.calls.generate.length === 1, 'the held redraw');
    expect(
      (await s.app.inject({ method: 'DELETE', url: `/api/brands/${s.brandId}/scenes/${saved.id}` })).statusCode,
    ).toBe(200);
    s.ctl.holdGenerate = null;
    s.ctl.open();
    expect((await s.settle(jobId)).status).toBe('cancelled');
  });

  it('keeps no picture and lands nothing when stopped while the hero draws (SS-H16)', async () => {
    const s = await setup();
    // words alone: the place (generate 1), the hero's plate (generate 2), its placement (edit 1)
    s.ctl.holdEdit = (n) => n === 1;
    const jobId = await s.start({ instruction: 'A raw concrete hall with a low plinth', conversation: 'c16' });
    await wait(() => s.calls.edit.length === 1, 'the hero placement');
    const saved = await s.saveScene({ name: 'Hall', prompt: 'A raw concrete hall with a low plinth.' });
    expect(
      (
        await s.app.inject({ method: 'POST', url: `${s.studioUrl}/${jobId}/attach`, payload: { sceneId: saved.id } })
      ).json().state,
    ).toBe('pending');
    await s.app.inject({ method: 'POST', url: `${s.studioUrl}/${jobId}/cancel` });
    const job = await s.settle(jobId);
    expect(job.status).toBe('cancelled');
    expect(s.sceneOf(saved.id).preview).toBeUndefined();
    expect(job.hash).toBeNull();
  });

  it('fails the hero out loud when its plate comes back empty, instead of drawing it off-scale (INF-H7)', async () => {
    const s = await setup();
    // the place is generate 1, the hero's plate is generate 2
    s.ctl.emptyGenerate = (n) => n === 2;
    const job = await s.studio({ instruction: 'A raw concrete hall with a low plinth', conversation: 'c-inf7' });
    expect(job.status).toBe('done');
    expect(job.hash).toMatch(/^[a-f0-9]{32}$/);
    expect(job.hero).toBeNull();
    expect(job.warnings.join(' ')).toContain('showing it in use did not work');
    // no silent fall-through to the ordinary, unscaled placement edit
    expect(s.calls.edit).toHaveLength(0);
  });

  it('outlives two dozen later jobs while a conversation still points at its picture (OP-H7)', async () => {
    const s = await setup();
    const kept = await s.studio({ kind: 'again', reading: READ, conversation: 'c-keep', label: 'Keep Me' });
    expect(kept.status).toBe('done');
    expect(kept.hash).toMatch(/^[a-f0-9]{32}$/);
    for (let i = 0; i < 25; i++) {
      const later = await s.studio({ instruction: `a quiet room number ${i}`, draw: false, conversation: `c-${i}` });
      expect(later.status).toBe('done');
    }
    const back = await s.app.inject({ method: 'GET', url: `${s.studioUrl}/${kept.id}` });
    expect(back.statusCode).toBe(200);
    expect(back.json().hash).toBe(kept.hash);
  });
});

describe('a scene read (an asset build)', { timeout: 60_000 }, () => {
  it('hands the reader no more pictures than a scene keeps (SS-H12)', async () => {
    const seen: number[] = [];
    const analyzer = {
      isAvailable: async () => ({ ok: true }),
      analyze: async (req: any) => {
        seen.push(req.imagePaths.length);
        return { name: 'Hall', prompt: 'A raw concrete hall.', lighting: 'Soft', subject: 'product', holds: [] };
      },
    };
    const s = await setup({ analyzer });
    const hashes: string[] = [];
    for (let i = 0; i < 20; i++) hashes.push(core.images.save(await png(10 + i * 11)));
    const res = await s.app.inject({
      method: 'POST',
      url: `/api/brands/${s.brandId}/asset-builds`,
      payload: { kind: 'scene', name: 'Hall', instruction: 'a hall', imageHashes: hashes },
    });
    expect(res.statusCode, res.body).toBe(200);
    await s.build(res.json().jobId);
    expect(seen[0]).toBeLessThanOrEqual(8);
  });

  it('is stopped by a shutdown, so nothing is left running once the library closes (SS-H13, OP-H9)', async () => {
    let signal: AbortSignal | undefined;
    const analyzer = {
      isAvailable: async () => ({ ok: true }),
      analyze: (_req: any, sig?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal = sig;
          sig?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    };
    const s = await setup({ analyzer });
    const photo = core.images.save(await png(77));
    const res = await s.app.inject({
      method: 'POST',
      url: `/api/brands/${s.brandId}/asset-builds`,
      payload: { kind: 'scene', name: 'Hall', instruction: 'a hall', imageHashes: [photo] },
    });
    expect(res.statusCode, res.body).toBe(200);
    await wait(() => !!signal, 'the reader');
    // Ctrl-C: serve.ts calls drain, then process.exit
    await s.app.drain();
    expect(signal?.aborted).toBe(true);
    expect(runningAssetBuildCount()).toBe(0);
  });

  it('reads a scene again with the whole direction the studio saved, 800 characters, not 400 (SS-H2)', async () => {
    const analyzed: any[] = [];
    const analyzer = {
      isAvailable: async () => ({ ok: true }),
      analyze: async (req: any) => {
        analyzed.push(req);
        return {
          name: 'Wet Basalt Shore',
          promptName: 'Wet Basalt Shore',
          lighting: 'Low directional sunset',
          description: 'A dark volcanic shoreline at last light.',
          subject: 'product' as const,
          prompt: 'A wet dark basalt shelf at low sunset light.',
          holds: [],
        };
      },
    };
    const s = await setup({ analyzer });
    const photo = core.images.save(await png(45));
    // about 700 characters, whole words, the length the studio's PLACE_MAX (800) allows
    const direction = Array.from({ length: 90 }, (_, i) => `stone${i}`)
      .join(' ')
      .slice(0, 700)
      .trim();
    expect(direction.length).toBeGreaterThan(650);
    const saved = await s.saveScene({
      name: 'Wet Basalt Shore',
      prompt: 'A wet dark basalt shelf at low sunset light.',
      lighting: 'Low directional sunset',
      refHashes: [photo],
      instruction: direction,
    });
    expect(s.sceneOf(saved.id).instruction).toBe(direction);

    const started = await s.app.inject({ method: 'POST', url: `/api/brands/${s.brandId}/scenes/${saved.id}/reread` });
    expect(started.statusCode).toBe(200);
    await s.build(started.json().jobId);
    expect(analyzed[0].instruction).toBe(direction);
    expect(s.sceneOf(saved.id).instruction).toBe(direction);
  });
});
