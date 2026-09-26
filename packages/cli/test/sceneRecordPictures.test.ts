import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { createDemoAnalyzer, createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { personError } from '../src/customAssets.js';
import { resetSceneStudio } from '../src/sceneStudio.js';
import { drainTracked, track } from './servers.js';

/**
 * A record only ever points at a picture the library holds, a Use that
 * arrives twice saves one scene, and a failure a person is shown never
 * carries a path from this machine.
 */

describe('personError', () => {
  it('keeps a sentence and hides a file-system error behind the fallback', () => {
    const fs = Object.assign(
      new Error("ENOENT: no such file or directory, copyfile '/Users/me/.scenri/images/a.png' -> '/tmp/x/input.png'"),
      { code: 'ENOENT' },
    );
    expect(personError(fs, 'It did not draw.')).toBe('It did not draw.');
    // wrapped by an engine, the code is gone and the path is still there
    expect(personError(new Error("codex failed: cannot read '/var/folders/ab/T/img.png'"), 'x')).toBe('x');
    expect(personError(new Error('failed to open C:\\Users\\me\\img.png'), 'x')).toBe('x');
    const rate = 'OpenRouter request failed: HTTP 429: {"error":{"message":"Rate limit exceeded","code":429}}';
    expect(personError(new Error(rate), 'x')).toBe(rate);
    expect(personError(new Error('codex exited with code 1: ERROR: unexpected status 401 Unauthorized'), 'x')).toBe(
      'codex exited with code 1: ERROR: unexpected status 401 Unauthorized',
    );
    expect(personError(undefined, 'x')).toBe('x');
  });
});

describe('scene records and their pictures', { timeout: 30_000 }, () => {
  let home: string;
  let templatesDir: string;
  let core: Core;
  const env = process.env.SCENRI_DEMO_BUILDS;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'scene-pictures-'));
    templatesDir = mkdtempSync(join(tmpdir(), 'scene-pictures-templates-'));
    core = createCore(home);
    resetSceneStudio();
    process.env.SCENRI_DEMO_BUILDS = '1';
  });
  afterEach(async () => {
    await drainTracked();
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
  const GONE = 'f'.repeat(32);

  async function setup() {
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
    const demo = createDemoEngine((b: Buffer) => core.images.save(b), { maxReferenceImages: 4 });
    const ctl = { editError: null as Error | null };
    const engine: EngineAdapter = {
      ...demo,
      capabilities: () => demo.capabilities(),
      costEstimate: async () => 0,
      edit: async (req, signal) => {
        if (ctl.editError) throw ctl.editError;
        return demo.edit(req, signal);
      },
    };
    const app = track(
      buildServer({
        core,
        engines: { all: () => [engine], get: (id: string) => (id === 'demo' ? engine : null) },
        sizeReader: createDemoAnalyzer(),
        analyzer: createDemoAnalyzer(),
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
    const scenes = () => ((core.store.getBrand(brand.id)?.json as any)?.scenes ?? []) as any[];
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scenes`, payload });
    return { app, ctl, brandId: brand.id as string, scenes, post };
  }

  const words = { name: 'Concrete Hall', prompt: 'A minimal brutalist hall of raw board-formed concrete.' };

  it('refuses a place picture the library does not hold, and leaves out a missing hero and references', async () => {
    const { app, brandId, scenes, post } = await setup();
    const place = core.images.save(await png(160));
    const ref = core.images.save(await png(90));
    expect((await post({ ...words, previewHash: GONE })).statusCode).toBe(400);
    const saved = await post({ ...words, previewHash: place, refHashes: [ref, GONE], heroHash: GONE });
    expect(saved.statusCode).toBe(200);
    const scene = scenes()[0];
    expect(scene.preview).toBe(`asset:${place}`);
    expect(scene.refs).toEqual([{ file: `asset:${ref}` }]);
    expect(scene.examples).toBeUndefined();
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brandId}/scenes/${scene.id}`,
      payload: { previewHash: GONE },
    });
    expect(patched.statusCode).toBe(400);
    expect(scenes()[0].preview).toBe(`asset:${place}`);
  });

  it('saves no presenter whose photos the library does not hold', async () => {
    const { app, brandId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/presenters`,
      payload: { name: 'Sam', shotHashes: [GONE], sourceHashes: [GONE] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers a Use that arrives twice from one conversation with the scene it already saved', async () => {
    const { app, brandId, scenes, post } = await setup();
    const place = core.images.save(await png(160));
    const first = await post({ ...words, previewHash: place, conversation: 'c-lost' });
    const again = await post({ ...words, previewHash: place, conversation: 'c-lost' });
    expect(again.statusCode).toBe(200);
    expect(again.json().scene.id).toBe(first.json().scene.id);
    expect(again.json().brand.id).toBe(brandId);
    expect(scenes()).toHaveLength(1);
    // another conversation, or none, is another scene
    await post({ ...words, previewHash: place, conversation: 'c-other' });
    await post({ ...words, previewHash: place });
    expect(scenes()).toHaveLength(3);
    // once the scene it saved is deleted, the conversation saves a new one
    await app.inject({ method: 'DELETE', url: `/api/brands/${brandId}/scenes/${first.json().scene.id}` });
    const after = await post({ ...words, previewHash: core.images.save(await png(161)), conversation: 'c-lost' });
    expect(after.json().scene.id).not.toBe(first.json().scene.id);
  });

  it('says an example failed without a path from this machine', async () => {
    const { app, ctl, brandId, scenes, post } = await setup();
    const id = (await post({ ...words, previewHash: core.images.save(await png(160)) })).json().scene.id as string;
    ctl.editError = Object.assign(
      new Error(
        `ENOENT: no such file or directory, copyfile '${home}/images/a.png' -> '/tmp/scenri-codex-x/input.png'`,
      ),
      { code: 'ENOENT' },
    );
    const url = `/api/brands/${brandId}/scenes/${id}/examples`;
    expect((await app.inject({ method: 'POST', url, payload: { first: true } })).statusCode).toBe(200);
    let job: any;
    for (const until = Date.now() + 20_000; Date.now() < until; ) {
      job = (await app.inject({ method: 'GET', url })).json().job;
      if (job && job.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(job.status).toBe('failed');
    expect(job.failed[0].error).not.toContain(home);
    expect(job.failed[0].error).not.toMatch(/ENOENT|\/tmp\//);
    expect(job.error).toBe(job.failed[0].error);
    expect(scenes()[0].examples).toBeUndefined();
  });
});
