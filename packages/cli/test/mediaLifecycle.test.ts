/**
 * What a person's pictures leave behind once they are discarded, replaced or
 * deleted: a face, a tattoo, a room, and everything drawn from one. Every
 * release goes through the store's reference check, so a picture another
 * record still holds stays.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { buildServer } from '../src/server.js';
import { resetAssetBuilds } from '../src/customAssets.js';
import { resetPresenterDrafts } from '../src/presenterDrafts.js';
import { resetSceneStudio } from '../src/sceneStudio.js';
import { drainTracked, track } from './servers.js';

let home: string;
let templatesDir: string;
let core: Core;
let app: ReturnType<typeof buildServer>;
/** Every picture the engine handed back, before any trim. */
let produced: string[];
/** Every reference path the engine was given. */
let given: string[];

const BAR = sharp({ create: { width: 100, height: 10, channels: 3, background: '#000' } })
  .png()
  .toBuffer();

/** A frame with letterbox bars, the way an engine sometimes answers: trimEdgeBars cuts it. */
const framed = async (n: number) =>
  sharp({ create: { width: 100, height: 125, channels: 3, background: { r: (n * 29) % 200, g: 120, b: 90 } } })
    .composite([
      { input: await BAR, top: 0, left: 0 },
      { input: await BAR, top: 115, left: 0 },
    ])
    .png()
    .toBuffer();

const photo = (n: number) =>
  sharp({ create: { width: 200, height: 250, channels: 3, background: { r: 40 + n * 20, g: 70, b: 150 - n * 10 } } })
    .png()
    .toBuffer();

const engine = (): EngineAdapter => ({
  capabilities: () => ({
    id: 'spy',
    displayName: 'Spy',
    localOnly: false,
    supportsEdit: true,
    supportsMask: false,
    maxReferenceImages: 5,
    // codex and openrouter both declare 2048; a phone photo is bigger than that
    maxReferenceEdge: 64,
  }),
  isAvailable: async () => ({ ok: true }),
  costEstimate: async () => 0,
  generate: async (req) => {
    given.push(...(req.referenceImages ?? []));
    const h = core.images.save(await framed(produced.length + 1));
    produced.push(h);
    return { images: [h], costUsd: 0 };
  },
  edit: async () => {
    const h = core.images.save(await framed(produced.length + 101));
    produced.push(h);
    return { images: [h], costUsd: 0 };
  },
});

beforeEach(() => {
  resetAssetBuilds();
  resetPresenterDrafts();
  resetSceneStudio();
  produced = [];
  given = [];
  templatesDir = mkdtempSync(join(tmpdir(), 'sc-media-tpl-'));
  mkdirSync(join(templatesDir, 'presenters'), { recursive: true });
  home = mkdtempSync(join(tmpdir(), 'sc-media-home-'));
  core = createCore(home);
  const e = engine();
  app = track(
    buildServer({
      core,
      engines: { all: () => [e], get: (id) => (id === 'spy' ? e : null) },
      templatesDir,
      analyzer: { isAvailable: async () => ({ ok: false, reason: 'off' }), analyze: async () => ({}) as any },
      sizeReader: null,
    }),
  );
});

afterEach(async () => {
  resetPresenterDrafts();
  resetSceneStudio();
  resetAssetBuilds();
  await drainTracked();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(templatesDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const j = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) } as any);
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};

/** Through the real upload route, the way both flows add a picture. */
const upload = async (buf: Buffer) => {
  const boundary = '----sec1boundary';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url: '/api/images',
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().hash as string;
};

const onDisk = () =>
  new Set(
    readdirSync(join(home, 'images'))
      .map((f) => /^([a-f0-9]{32})\./.exec(f)?.[1])
      .filter((h): h is string => !!h),
  );
const servable = async (h: string) => (await app.inject({ method: 'GET', url: `/api/images/${h}` })).statusCode === 200;
const stillServed = async (hashes: Iterable<string>) => {
  const out: string[] = [];
  for (const h of hashes) if (await servable(h)) out.push(h);
  return out;
};

const wait = async (cond: () => Promise<boolean>, what: string) => {
  for (const until = Date.now() + 15_000; Date.now() < until; ) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
};

const newBrand = async () =>
  (await j('POST', '/api/brands', { brand: { specVersion: '0.1', meta: { name: 'Acme' } } })).body.id as string;

describe('what a person’s pictures leave behind', { timeout: 30_000 }, () => {
  it('a detail picture (a tattoo, a scar) is gone once its draft is discarded (SEC-H1c)', async () => {
    const brandId = await newBrand();
    const detail = await upload(await photo(1));
    const base = `/api/brands/${brandId}/presenter-drafts`;
    const made = await j('POST', base, {
      source: 'synthetic',
      direction: 'a man in his thirties',
      keepItems: [{ id: 'tattoo', words: 'a rose tattoo on the left forearm', refs: [detail] }],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    expect(JSON.stringify(made.body)).toContain(detail);
    expect((await j('DELETE', `${base}/${made.body.id}`)).status).toBe(200);
    expect(await servable(detail)).toBe(false);
  });

  it('a detail picture is kept by the saved presenter or let go, never left owned by nothing (SEC1-X2)', async () => {
    const brandId = await newBrand();
    const detail = await upload(await photo(9));
    const base = `/api/brands/${brandId}/presenter-drafts`;
    const made = await j('POST', base, {
      source: 'synthetic',
      direction: 'a woman in her forties',
      name: 'Mara',
      keepItems: [{ id: 'scar', words: 'a thin scar through the left eyebrow', refs: [detail] }],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const id = made.body.id as string;
    const idle = async () => {
      const b = (await j('GET', `${base}/${id}`)).body;
      return b.stage === 'idle' && !b.activeView;
    };
    for (const v of ['portrait', 'front', 'three-quarter']) {
      expect((await j('POST', `${base}/${id}/views/${v}/generate`, {})).status).toBe(200);
      await wait(idle, `the ${v}`);
      expect((await j('POST', `${base}/${id}/views/${v}/approve`)).status).toBe(200);
      await wait(idle, `the ${v} approval`);
    }
    const saved = await j('POST', `${base}/${id}/save`);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const record = JSON.stringify((core.store.getBrand(brandId)?.json as any)?.characters ?? []);
    // either the record keeps it (so a delete can find it) or it is let go of
    if (!record.includes(detail)) expect(await servable(detail)).toBe(false);
  });

  it('discarding a drawn photos draft leaves no picture of that person behind (SEC-H1d, SEC1-X1)', async () => {
    const brandId = await newBrand();
    const before = onDisk();
    const face = await upload(await photo(2));
    const base = `/api/brands/${brandId}/presenter-drafts`;
    const made = await j('POST', base, { source: 'photos', imageHashes: [face], attestation: true });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const id = made.body.id as string;
    await wait(async () => (await j('GET', `${base}/${id}`)).body.stage !== 'analyzing', 'the photo read');
    expect((await j('POST', `${base}/${id}/views/portrait/generate`, {})).status).toBe(200);
    let slot: any;
    await wait(async () => {
      slot = (await j('GET', `${base}/${id}`)).body.views.portrait;
      return !!slot.hash && slot.status !== 'generating';
    }, 'the portrait');
    const created = [...onDisk()].filter((h) => !before.has(h));
    const capped = given.map((p) => /([a-f0-9]{32})\.\w+$/.exec(p)?.[1]).filter((h) => h && h !== face);
    expect((await j('DELETE', `${base}/${id}`)).status).toBe(200);
    const left = await stillServed(created);
    const name = (h: string) =>
      h === face
        ? 'source photo'
        : h === slot.hash
          ? 'portrait'
          : capped.includes(h)
            ? 'downscaled copy of the source photo (capReferenceEdge)'
            : produced.includes(h)
              ? 'untrimmed engine frame (trimEdgeBars)'
              : 'other';
    expect(left.map(name)).toEqual([]);
  });

  it('deleting a scene lets go of the pictures it was made from and every picture it wore (SEC-H1a)', async () => {
    const brandId = await newBrand();
    const room1 = await upload(await photo(3));
    const room2 = await upload(await photo(4));
    const url = `/api/brands/${brandId}/scene-studio/jobs`;
    const settle = async (payload: Record<string, unknown>) => {
      const started = await j('POST', url, payload);
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      let job: any;
      await wait(async () => {
        job = (await j('GET', `${url}/${started.body.jobId}`)).body;
        return job.status !== 'running';
      }, 'the studio job');
      expect(job.status, job.error).toBe('done');
      return job;
    };
    const made = await settle({
      kind: 'make',
      instruction: 'A sunlit loft kitchen with a long oak table',
      imageHashes: [room1, room2],
      conversation: 'sec1',
    });
    const again = await settle({
      kind: 'again',
      reading: made.reading,
      imageHashes: [room1, room2],
      conversation: 'sec1',
    });
    // Use: the first version is saved with its pictures
    const saved = await j('POST', `/api/brands/${brandId}/scenes`, {
      ...made.reading,
      previewHash: made.hash,
      anchor: made.anchor,
      refHashes: [room1, room2],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const sceneId = saved.body.scene.id as string;
    // Use again: the scene now wears the Try again version
    const used = await j('PATCH', `/api/brands/${brandId}/scenes/${sceneId}`, { previewHash: again.hash });
    expect(used.status).toBe(200);
    expect((await j('DELETE', `/api/brands/${brandId}/scenes/${sceneId}`)).status).toBe(200);
    expect(await stillServed([room1, room2, again.hash, made.hash])).toEqual([]);
  });

  it('deleting a brand lets go of the photos its presenter drafts and scenes held (SEC-H1h)', async () => {
    const brandId = await newBrand();
    const face = await upload(await photo(5));
    const room = await upload(await photo(6));
    const made = await j('POST', `/api/brands/${brandId}/presenter-drafts`, {
      source: 'photos',
      imageHashes: [face],
      attestation: true,
    });
    expect(made.status).toBe(200);
    const scene = await j('POST', `/api/brands/${brandId}/scenes`, {
      name: 'Loft',
      prompt: 'A sunlit loft kitchen',
      refHashes: [room],
      previewHash: room,
    });
    expect(scene.status, JSON.stringify(scene.body)).toBe(200);
    expect((await j('DELETE', `/api/brands/${brandId}`)).status).toBe(200);
    expect(core.store.getBrand(brandId)).toBeFalsy();
    expect(await stillServed([face, room])).toEqual([]);
  });
});
