/**
 * What the API takes from outside: the files POST /api/images accepts and how a
 * stored picture is served, and every presenter and scene route asked with an
 * id that is malformed, missing, deleted or another brand's.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { createDemoAnalyzer, createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { resetAssetBuilds } from '../src/customAssets.js';
import { resetPresenterDrafts } from '../src/presenterDrafts.js';
import { resetSceneStudio } from '../src/sceneStudio.js';
import { drainTracked, track } from './servers.js';

let home: string;
let templatesDir: string;
let core: Core;
const envBuilds = process.env.SCENRI_DEMO_BUILDS;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-api-surface-'));
  templatesDir = mkdtempSync(join(tmpdir(), 'sc-api-surface-templates-'));
  mkdirSync(join(templatesDir, 'presenters'), { recursive: true });
  core = createCore(home);
  resetSceneStudio();
  resetAssetBuilds();
  resetPresenterDrafts();
  process.env.SCENRI_DEMO_BUILDS = '1';
});
afterEach(async () => {
  resetPresenterDrafts();
  resetAssetBuilds();
  await drainTracked();
  try {
    core.close();
  } catch {
    // a drained server closes the core on its way out
  }
  if (envBuilds === undefined) delete process.env.SCENRI_DEMO_BUILDS;
  else process.env.SCENRI_DEMO_BUILDS = envBuilds;
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(templatesDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const png = (shade: number, w = 64, h = 80) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: shade, g: 90, b: 255 - shade } } })
    .png()
    .toBuffer();

/** The demo engine, with a picture of its own for every draw. */
function demoEngine(): EngineAdapter {
  const demo = createDemoEngine((b: Buffer) => core.images.save(b), { maxReferenceImages: 4 });
  let calls = 0;
  return {
    ...demo,
    capabilities: () => demo.capabilities(),
    costEstimate: async () => 0,
    generate: async (_req, _signal, onImage) => {
      calls++;
      const hash = core.images.save(await png((calls * 37) % 256));
      onImage?.(0, hash);
      return { images: [hash], costUsd: 0 };
    },
  };
}

function start() {
  const engine = demoEngine();
  const app = track(
    buildServer({
      core,
      engines: { all: () => [engine], get: (id: string) => (id === 'demo' ? engine : null) },
      sizeReader: createDemoAnalyzer(),
      analyzer: createDemoAnalyzer(),
      templatesDir,
    }),
  );
  const call = async (method: string, url: string, payload?: unknown, opts: Record<string, unknown> = {}) => {
    const res = await app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
      ...opts,
    } as any);
    let body: any = null;
    try {
      body = res.json();
    } catch {
      body = res.body;
    }
    return { status: res.statusCode, body, headers: res.headers };
  };
  const newBrand = async (name: string) =>
    (await call('POST', '/api/brands', { brand: { specVersion: '0.1', meta: { name } } })).body.id as string;
  return { app, call, newBrand };
}

/** A multipart body with one file, built by hand so filename and content type are whatever the test says. */
function multipart(buf: Buffer, filename: string, type: string) {
  const boundary = '----scenriupload';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, buf, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** A 64x48 HEVC HEIC, as an iPhone or `sips -s format heic` writes it (626 bytes). */
const HEIC_B64 =
  'AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABw21ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAAA5mlwcnAAAADFaXBjbwAAABNjb2xybmNseAACAAIABoAAAAAMY2xsaQDLAEAAAAAUaXNwZQAAAAAAAABAAAAAMAAAAAlpcm90AAAAABBwaXhpAAAAAAMICAgAAABxaHZjQwEDcAAAALAAAAAAAB7wAPz9+PgAAAsDoAABABdAAQwB//8DcAAAAwCwAAADAAADAB5wJKEAAQAjQgEBA3AAAAMAsAAAAwAAAwAeoBQgQcGMTiHuRZVNwICBgCCiAAEACUQBwGFyyERTZAAAABlpcG1hAAAAAAAAAAEAAQaBAgMFhoQAAAAsaWxvYwAAAABEAAACAAEAAAABAAACQwAAAC8AAgAAAAEAAAH3AAAATAAAAAFtZGF0AAAAAAAAAIsAAAAGRXhpZgAATU0AKgAAAAgAAwEaAAUAAAABAAAAMgEbAAUAAAABAAAAOgEoAAMAAAABAAIAAAAAAAAAAAAZAAAAAQAAABkAAAABAAAAKygBr6L2RoF8//ww3//HH7L6KEPsNrRPOvP70Zn/9RNP6f/QPm4HCZqbVH4=';

describe('what POST /api/images takes', { timeout: 60_000 }, () => {
  it('refuses hostile files or flattens them to a plain PNG, and the filename never picks the path', async () => {
    const { call } = start();
    const post = async (buf: Buffer, filename: string, type: string) => {
      const mp = multipart(buf, filename, type);
      const res = await call('POST', '/api/images', mp.payload, { headers: mp.headers });
      if (res.status !== 200) return { status: res.status };
      const meta = await sharp(core.images.read(res.body.hash)).metadata();
      return { status: 200, format: meta.format, exif: !!meta.exif, pages: meta.pages ?? 1 };
    };
    const svg = (body: string, head = '') =>
      Buffer.from(
        `<?xml version="1.0"?>${head}<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">${body}</svg>`,
      );
    const lol = ['<!ENTITY l0 "lol">']
      .concat(Array.from({ length: 9 }, (_, i) => `<!ENTITY l${i + 1} "${`&l${i};`.repeat(10)}">`))
      .join('');
    const red = await png(200, 8, 8);
    const gps = await sharp(red)
      .withExif({ IFD0: { Make: 'SEC2' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } })
      .jpeg()
      .toBuffer();
    expect({
      script: await post(svg('<script>alert(1)</script><rect width="64" height="64"/>'), 'a.svg', 'image/svg+xml'),
      bomb: await post(svg('<text>&l9;</text>', `<!DOCTYPE s [${lol}]>`), 'b.svg', 'image/svg+xml'),
      xxe: await post(
        svg('<text>&x;</text>', '<!DOCTYPE s [<!ENTITY x SYSTEM "file:///etc/hosts">]>'),
        'c.svg',
        'image/svg+xml',
      ),
      huge: await post(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200000" height="200000"/>'),
        'd.svg',
        'image/svg+xml',
      ),
      polyglot: await post(Buffer.from('GIF89a<script>alert(1)</script>'), 'e.gif', 'image/gif'),
      animated: await post(
        await sharp([red, await png(20, 8, 8)], { join: { animated: true } })
          .gif()
          .toBuffer(),
        'f.gif',
        'image/gif',
      ),
      mislabelled: await post(red, '../../../../tmp/sec2.jpg', 'image/gif'),
      gps: await post(gps, 'g.jpg', 'image/jpeg'),
    }).toEqual({
      script: { status: 200, format: 'png', exif: false, pages: 1 },
      bomb: { status: 400 },
      xxe: { status: 400 },
      huge: { status: 400 },
      polyglot: { status: 400 },
      animated: { status: 200, format: 'png', exif: false, pages: 1 },
      mislabelled: { status: 200, format: 'png', exif: false, pages: 1 },
      gps: { status: 200, format: 'png', exif: false, pages: 1 },
    });
    expect(readdirSync(join(home, 'images')).every((f) => /^[a-f0-9]{32}\.png$/.test(f))).toBe(true);
  });

  it('refuses a HEIC photo, which the studio says it cannot read yet (SEC2-X1)', async () => {
    const { call } = start();
    const heic = Buffer.from(HEIC_B64, 'base64');
    expect(heic.subarray(4, 12).toString('latin1')).toBe('ftypheic');
    const before = readdirSync(join(home, 'images')).length;
    const mp = multipart(heic, 'IMG_0001.HEIC', 'image/heic');
    const res = await call('POST', '/api/images', mp.payload, { headers: mp.headers });
    // presenterCopy.photoUnreadable and the scene's heicNotYet say HEIC is not read yet: the store agrees
    expect(res.status).toBe(400);
    expect(readdirSync(join(home, 'images'))).toHaveLength(before);
  });

  it('stores a 16000 by 16000 upload at a bounded size (SEC-H5)', async () => {
    const { call } = start();
    const bomb = await sharp({
      create: { width: 16000, height: 16000, channels: 3, background: '#223344' },
      limitInputPixels: false,
    })
      .png({ compressionLevel: 1 })
      .toBuffer();
    const mp = multipart(bomb, 'p.png', 'image/png');
    const res = await call('POST', '/api/images', mp.payload, { headers: mp.headers });
    if (res.status !== 200) {
      expect(res.status).toBe(400);
      return;
    }
    const meta = await sharp(core.images.pathFor(res.body.hash), { limitInputPixels: false }).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(8192);
  });

  it('serves a stored picture and its thumbnail as private, never cacheable by a shared cache (SEC-H2)', async () => {
    const { app } = start();
    const hash = core.images.save(await png(1, 200, 250));
    const original = await app.inject({ method: 'GET', url: `/api/images/${hash}` });
    const thumb = await app.inject({ method: 'GET', url: `/api/images/${hash}/thumb?w=640` });
    for (const res of [original, thumb]) {
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['cache-control'])).not.toMatch(/\bpublic\b/);
      expect(String(res.headers['cache-control'])).toMatch(/\bprivate\b/);
    }
  });
});

describe('ids and hashes on every presenter and scene route', () => {
  it('answer malformed, missing, deleted and cross-brand ids with 400 or 404, never 2xx or 5xx', async () => {
    const { call, newBrand } = start();
    const A = await newBrand('Alpha');
    const B = await newBrand('Beta');
    const C = await newBrand('Gamma');
    const up = multipart(await png(10), 'a.png', 'image/png');
    const hash = (await call('POST', '/api/images', up.payload, { headers: up.headers })).body.hash as string;
    expect(hash).toMatch(/^[a-f0-9]{32}$/);

    const draft = async (brand: string) =>
      (await call('POST', `/api/brands/${brand}/presenter-drafts`, { source: 'synthetic', direction: 'a man, 30s' }))
        .body.id as string;
    const presenter = async (brand: string) =>
      (await call('POST', `/api/brands/${brand}/presenters`, { name: 'Pat', shotHashes: [hash] })).body.presenter
        .id as string;
    const scene = async (brand: string) =>
      (await call('POST', `/api/brands/${brand}/scenes`, { name: 'Loft', prompt: 'a bright loft', refHashes: [hash] }))
        .body.scene.id as string;

    const ids = {
      draft: await draft(A),
      draftGone: await draft(A),
      presenter: await presenter(A),
      presenterGone: await presenter(A),
      scene: await scene(A),
      sceneGone: await scene(A),
      job: (await call('POST', `/api/brands/${A}/scene-studio/jobs`, { kind: 'make', instruction: 'a bright loft' }))
        .body.jobId as string,
      build: (await call('POST', `/api/brands/${A}/asset-builds`, { kind: 'scene', name: 'Loft', instruction: 'loft' }))
        .body.jobId as string,
    };
    for (const [k, v] of Object.entries(ids)) expect(v, k).toBeTruthy();
    const cDraft = await draft(C);
    expect((await call('DELETE', `/api/brands/${A}/presenter-drafts/${ids.draftGone}`)).status).toBe(200);
    expect((await call('DELETE', `/api/brands/${A}/presenters/${ids.presenterGone}`)).status).toBe(200);
    expect((await call('DELETE', `/api/brands/${A}/scenes/${ids.sceneGone}`)).status).toBe(200);
    expect((await call('DELETE', `/api/brands/${C}`)).status).toBe(200);

    type Route = {
      name: string;
      method: string;
      path: (b: string, id: string) => string;
      body?: unknown;
      kind: keyof typeof live;
    };
    const live = {
      draft: ids.draft,
      presenter: ids.presenter,
      scene: ids.scene,
      job: ids.job,
      build: ids.build,
    };
    const gone = { draft: ids.draftGone, presenter: ids.presenterGone, scene: ids.sceneGone, job: null, build: null };
    const d = (rest: string) => (b: string, id: string) => `/api/brands/${b}/presenter-drafts/${id}${rest}`;
    const p = (rest: string) => (b: string, id: string) => `/api/brands/${b}/presenters/${id}${rest}`;
    const s = (rest: string) => (b: string, id: string) => `/api/brands/${b}/scenes/${id}${rest}`;
    const j = (rest: string) => (b: string, id: string) => `/api/brands/${b}/scene-studio/jobs/${id}${rest}`;
    const ab = (rest: string) => (b: string, id: string) => `/api/brands/${b}/asset-builds/${id}${rest}`;
    const routes: Route[] = [
      { name: 'GET draft', method: 'GET', path: d(''), kind: 'draft' },
      { name: 'PATCH draft', method: 'PATCH', path: d(''), body: { name: 'x' }, kind: 'draft' },
      { name: 'generate view', method: 'POST', path: d('/views/portrait/generate'), body: {}, kind: 'draft' },
      { name: 'approve view', method: 'POST', path: d('/views/portrait/approve'), kind: 'draft' },
      { name: 'redo view', method: 'POST', path: d('/views/portrait/redo'), kind: 'draft' },
      { name: 'revert view', method: 'POST', path: d('/views/portrait/revert'), kind: 'draft' },
      { name: 'restore view', method: 'POST', path: d('/views/portrait/restore'), body: { hash }, kind: 'draft' },
      { name: 'use-photo', method: 'POST', path: d('/views/portrait/use-photo'), body: { hash }, kind: 'draft' },
      { name: 'save draft', method: 'POST', path: d('/save'), kind: 'draft' },
      { name: 'stop draft', method: 'POST', path: d('/stop'), kind: 'draft' },
      { name: 'DELETE draft', method: 'DELETE', path: d(''), kind: 'draft' },
      { name: 'edit presenter', method: 'POST', path: p('/edit'), kind: 'presenter' },
      { name: 'PATCH presenter', method: 'PATCH', path: p(''), body: { name: 'y' }, kind: 'presenter' },
      { name: 'revert presenter', method: 'POST', path: p('/revert'), kind: 'presenter' },
      { name: 'duplicate presenter', method: 'POST', path: p('/duplicate'), kind: 'presenter' },
      { name: 'DELETE presenter', method: 'DELETE', path: p(''), kind: 'presenter' },
      { name: 'PATCH scene', method: 'PATCH', path: s(''), body: { name: 'z' }, kind: 'scene' },
      { name: 'reread scene', method: 'POST', path: s('/reread'), kind: 'scene' },
      { name: 'preview scene', method: 'POST', path: s('/preview'), kind: 'scene' },
      { name: 'GET examples', method: 'GET', path: s('/examples'), kind: 'scene' },
      { name: 'POST examples', method: 'POST', path: s('/examples'), body: { roles: ['hero'] }, kind: 'scene' },
      { name: 'stop examples', method: 'POST', path: s('/examples/stop'), kind: 'scene' },
      { name: 'DELETE example', method: 'DELETE', path: s('/examples/hero'), kind: 'scene' },
      { name: 'DELETE scene', method: 'DELETE', path: s(''), kind: 'scene' },
      { name: 'GET studio job', method: 'GET', path: j(''), kind: 'job' },
      { name: 'cancel studio job', method: 'POST', path: j('/cancel'), kind: 'job' },
      { name: 'label studio job', method: 'POST', path: j('/label'), body: { label: 'x' }, kind: 'job' },
      { name: 'attach studio job', method: 'POST', path: j('/attach'), body: { sceneId: ids.scene }, kind: 'job' },
      { name: 'GET build', method: 'GET', path: ab(''), kind: 'build' },
      { name: 'cancel build', method: 'POST', path: ab('/cancel'), kind: 'build' },
      { name: 'DELETE build', method: 'DELETE', path: ab(''), kind: 'build' },
    ];
    const MALFORMED = ['..%2F..%2Fscenri.db', '__proto__', 'constructor', '%00', 'a'.repeat(300), 'pd-00000000'];
    const bad: string[] = [];
    const run = async (route: Route, kase: string, brand: string, id: string) => {
      const res = await call(route.method, route.path(brand, id), route.body);
      if (res.status < 400 || res.status >= 500)
        bad.push(`${route.name} [${kase}] -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
    };
    for (const route of routes) {
      for (const m of MALFORMED) await run(route, `malformed ${m.slice(0, 12)}`, A, m);
      const goneId = gone[route.kind];
      if (goneId) await run(route, 'deleted', A, goneId);
      await run(route, 'cross-brand', B, live[route.kind]);
      await run(route, 'brand nonexistent', '00000000-0000-0000-0000-000000000000', live[route.kind]);
      await run(route, 'brand deleted', C, route.kind === 'draft' ? cDraft : live[route.kind]);
    }
    // what a bad view name does
    for (const v of ['nope', '__proto__', 'constructor', 'toString']) {
      await run(
        { name: `generate view ${v}`, method: 'POST', path: d(`/views/${v}/generate`), body: {}, kind: 'draft' },
        'bad view',
        A,
        ids.draft,
      );
      await run(
        { name: `approve view ${v}`, method: 'POST', path: d(`/views/${v}/approve`), kind: 'draft' },
        'bad view',
        A,
        ids.draft,
      );
    }
    // Nothing of A's was touched by any of it.
    expect((await call('GET', `/api/brands/${A}/presenter-drafts/${ids.draft}`)).status).toBe(200);
    const a = (await call('GET', '/api/brands')).body.find((b: any) => b.id === A).json;
    expect(a.characters.map((c: any) => c.id)).toContain(ids.presenter);
    expect(a.scenes.map((x: any) => x.id)).toContain(ids.scene);
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
