import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter, type GenerateRequest } from '@scenri/core';
import { buildServer } from '../src/server.js';
import { resetAssetBuilds } from '../src/customAssets.js';
import { resetPresenterDrafts, runningDraftJobCount } from '../src/presenterDrafts.js';

/**
 * The presenter studio's API: a draft is created, its views are drawn and
 * decided one at a time, and the save is a presenter like any other. The
 * engine is the same spy the asset-build tests use.
 */
describe('presenter draft routes', () => {
  let home: string;
  let templatesDir: string;
  let core: Core;
  let app: ReturnType<typeof buildServer>;
  let generated: GenerateRequest[];

  const png = (tint: string, w = 1024, h = 1280) =>
    sharp({ create: { width: w, height: h, channels: 3, background: tint } })
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
    }),
    isAvailable: async () => ({ ok: true }),
    costEstimate: async () => 0,
    generate: async (req) => {
      generated.push(req);
      const shade = (0x20 + generated.length * 0x0b).toString(16).padStart(2, '0');
      return { images: [core.images.save(await png(`#${shade}4050`))], costUsd: 0 };
    },
    edit: async () => ({ images: [], costUsd: 0 }),
  });

  const analyzer = () => ({
    isAvailable: async () => ({ ok: true }),
    analyze: async (req: any) => ({
      promptName: 'a man in his thirties with a dark beard',
      presentation: 'man' as const,
      descriptor: 'Warm · dark beard · direct',
      ageRange: 'mid 30s',
      hair: 'short dark hair',
      identityNotes: 'the beard and the heavy brow must survive every generation',
      negativeConstraints: [],
      suitableCategories: [],
      coverage: [],
      ...(req.classifyPhotos ? { photos: [{ index: 0, view: 'portrait' as const, usable: true, note: 'sharp' }] } : {}),
    }),
  });

  const start = () => {
    const e = engine();
    return buildServer({
      core,
      engines: { all: () => [e], get: (id) => (id === 'spy' ? e : null) },
      templatesDir,
      analyzer: analyzer(),
    });
  };

  beforeEach(() => {
    resetAssetBuilds();
    resetPresenterDrafts();
    generated = [];
    templatesDir = mkdtempSync(join(tmpdir(), 'sc-pdr-templates-'));
    mkdirSync(join(templatesDir, 'presenters'), { recursive: true });
    home = mkdtempSync(join(tmpdir(), 'sc-pdr-home-'));
    core = createCore(home);
    app = start();
  });

  afterEach(async () => {
    resetPresenterDrafts();
    resetAssetBuilds();
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(templatesDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const newBrand = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json() as { id: string };

  const j = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const opts: Record<string, unknown> = { method, url };
    if (payload !== undefined) opts.payload = payload;
    const res = await app.inject(opts as any);
    return { status: res.statusCode, body: res.json() as any };
  };

  /** Wait for whatever the draft is drawing. */
  const settled = async (brandId: string, draftId: string) => {
    for (let i = 0; i < 400; i++) {
      const { body } = await j('GET', `/api/brands/${brandId}/presenter-drafts/${draftId}`);
      if (body.stage === 'idle' && !body.activeView && runningDraftJobCount() === 0) return body;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('the draft never settled');
  };

  it('creates, draws, decides and saves a person from scratch', async () => {
    const brand = await newBrand();
    const base = `/api/brands/${brand.id}/presenter-drafts`;
    const created = await j('POST', base, { source: 'synthetic', direction: 'a man in his 30s with a dark beard' });
    expect(created.status).toBe(200);
    const id = created.body.id as string;
    expect(id).toMatch(/^pd-[a-f0-9]{8}$/);
    expect((await j('GET', base)).body.drafts.map((d: any) => d.id)).toEqual([id]);

    const started = await j('POST', `${base}/${id}/views/portrait/generate`, {});
    expect(started.status).toBe(200);
    expect(started.body.draft.views.portrait.status).toBe('generating');
    expect((await j('POST', `${base}/${id}/views/portrait/generate`, {})).status).toBe(409);
    let d = await settled(brand.id, id);
    expect(d.views.portrait.status).toBe('candidate');

    expect((await j('POST', `${base}/${id}/views/portrait/approve`)).body.views.portrait.status).toBe('approved');
    await j('POST', `${base}/${id}/views/front/generate`, {});
    d = await settled(brand.id, id);
    expect(d.views.front.conditionedOn).toEqual([d.views.portrait.hash]);
    await j('POST', `${base}/${id}/views/front/approve`);
    await j('POST', `${base}/${id}/views/left/generate`, { adjustment: 'a touch more smile' });
    d = await settled(brand.id, id);
    expect(d.views['left'].adjustment).toBe('a touch more smile');
    await j('POST', `${base}/${id}/views/left/approve`);
    for (const v of ['back', 'right']) {
      await j('POST', `${base}/${id}/views/${v}/generate`, {});
      await settled(brand.id, id);
      await j('POST', `${base}/${id}/views/${v}/approve`);
    }

    expect((await j('POST', `${base}/${id}/save`)).status).toBe(400); // no name yet
    expect((await j('PATCH', `${base}/${id}`, { name: 'Tomas', facets: ['Beauty'] })).body.name).toBe('Tomas');
    const saved = await j('POST', `${base}/${id}/save`);
    expect(saved.status).toBe(200);
    expect(saved.body.presenter).toMatchObject({ name: 'Tomas', origin: 'custom', source: 'synthetic' });
    expect(saved.body.brand.json.characters).toHaveLength(1);
    expect((await j('GET', `${base}/${id}`)).status).toBe(404);
  });

  it('a revised approved view can be used or kept as it was, through the route', async () => {
    const brand = await newBrand();
    const base = `/api/brands/${brand.id}/presenter-drafts`;
    const { body: made } = await j('POST', base, { source: 'synthetic', direction: 'someone' });
    await j('POST', `${base}/${made.id}/views/portrait/generate`, {});
    let d = await settled(brand.id, made.id);
    await j('POST', `${base}/${made.id}/views/portrait/approve`);
    const face = d.views.portrait.hash;
    // nothing to keep yet
    expect((await j('POST', `${base}/${made.id}/views/portrait/revert`)).status).toBe(400);
    await j('POST', `${base}/${made.id}/views/portrait/generate`, { adjustment: 'shorter hair' });
    d = await settled(brand.id, made.id);
    expect(d.views.portrait).toMatchObject({ status: 'candidate', prior: face });
    const kept = await j('POST', `${base}/${made.id}/views/portrait/revert`);
    expect(kept.status).toBe(200);
    expect(kept.body.views.portrait).toMatchObject({ status: 'approved', hash: face });
    expect(kept.body.views.portrait.prior).toBeUndefined();
  });

  it('a draft belongs to its brand', async () => {
    const acme = await newBrand();
    const other = await newBrand();
    const { body } = await j('POST', `/api/brands/${acme.id}/presenter-drafts`, {
      source: 'synthetic',
      direction: 'x',
    });
    expect((await j('GET', `/api/brands/${other.id}/presenter-drafts/${body.id}`)).status).toBe(404);
    expect((await j('DELETE', `/api/brands/${other.id}/presenter-drafts/${body.id}`)).status).toBe(404);
    expect((await j('GET', `/api/brands/${other.id}/presenter-drafts`)).body.drafts).toEqual([]);
  });

  it('refuses what the module refuses, with the reason', async () => {
    const brand = await newBrand();
    const base = `/api/brands/${brand.id}/presenter-drafts`;
    const noWords = await j('POST', base, { source: 'synthetic', direction: '' });
    expect(noWords.status).toBe(400);
    expect(noWords.body.error).toMatch(/describe/);
    const photo = core.images.save(await png('#a08070', 800, 1000));
    const noConsent = await j('POST', base, { source: 'photos', imageHashes: [photo] });
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.error).toMatch(/permission/);
    const { body } = await j('POST', base, { source: 'synthetic', direction: 'someone' });
    const early = await j('POST', `${base}/${body.id}/views/front/generate`, {});
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/face/);
    expect((await j('POST', `${base}/${body.id}/views/sideways/generate`, {})).status).toBe(400);
  });

  it('from photos: the likeness is confirmed, a photo can be placed by hand, the originals are kept', async () => {
    const brand = await newBrand();
    const base = `/api/brands/${brand.id}/presenter-drafts`;
    const a = core.images.save(await png('#a08070', 800, 1000));
    const b = core.images.save(await png('#b09080', 800, 1000));
    const created = await j('POST', base, { source: 'photos', imageHashes: [a, b], attestation: true, name: 'Noor' });
    expect(created.status).toBe(200);
    let d = await settled(brand.id, created.body.id);
    expect(d.attestation.version).toBe('v1');
    expect(d.views.portrait).toMatchObject({ status: 'approved', hash: a, origin: 'photo' });
    const placed = await j('POST', `${base}/${d.id}/views/front/use-photo`, { hash: b });
    expect(placed.status).toBe(200);
    expect(placed.body.views.front).toMatchObject({ status: 'approved', hash: b, origin: 'photo' });
    expect((await j('POST', `${base}/${d.id}/views/front/use-photo`, { hash: 'f'.repeat(32) })).status).toBe(400);
    const redone = await j('POST', `${base}/${d.id}/views/front/redo`);
    expect(redone.body.views.front.status).toBe('empty');
    await j('POST', `${base}/${d.id}/views/front/generate`, {});
    d = await settled(brand.id, d.id);
    await j('POST', `${base}/${d.id}/views/front/approve`);
    await j('POST', `${base}/${d.id}/views/left/generate`, {});
    d = await settled(brand.id, d.id);
    await j('POST', `${base}/${d.id}/views/left/approve`);
    for (const v of ['back', 'right']) {
      await j('POST', `${base}/${d.id}/views/${v}/generate`, {});
      d = await settled(brand.id, d.id);
      await j('POST', `${base}/${d.id}/views/${v}/approve`);
    }
    const saved = await j('POST', `${base}/${d.id}/save`);
    expect(saved.status).toBe(200);
    expect(saved.body.presenter.source).toBe('photos');
    expect(saved.body.presenter.likeness.version).toBe('v1');
    expect(saved.body.presenter.sourceRefs.map((s: any) => s.file)).toEqual([`asset:${a}`, `asset:${b}`]);
    expect(existsSync(core.images.pathFor(a))).toBe(true);
    expect(existsSync(core.images.pathFor(b))).toBe(true);
  });

  it('discarding stops a running step and takes the pictures and their thumbnails with it', async () => {
    const brand = await newBrand();
    const base = `/api/brands/${brand.id}/presenter-drafts`;
    const { body } = await j('POST', base, { source: 'synthetic', direction: 'someone' });
    await j('POST', `${base}/${body.id}/views/portrait/generate`, {});
    let d = await settled(brand.id, body.id);
    const first = d.views.portrait.hash as string;
    await j('POST', `${base}/${body.id}/views/portrait/generate`, {});
    d = await settled(brand.id, body.id);
    const second = d.views.portrait.hash as string;
    // a thumbnail exists for a picture the stage showed
    expect((await app.inject({ method: 'GET', url: `/api/images/${first}/thumb?w=160` })).statusCode).toBe(200);
    const thumb = join(home, 'thumbs', `${first}-w160.webp`);
    expect(existsSync(thumb)).toBe(true);
    await j('POST', `${base}/${body.id}/views/portrait/generate`, {});
    expect(runningDraftJobCount()).toBe(1);
    expect((await j('DELETE', `${base}/${body.id}`)).status).toBe(200);
    expect(runningDraftJobCount()).toBe(0);
    expect((await j('GET', `${base}/${body.id}`)).status).toBe(404);
    expect(existsSync(core.images.pathFor(first))).toBe(false);
    expect(existsSync(core.images.pathFor(second))).toBe(false);
    expect(existsSync(thumb)).toBe(false);
  });

  it('a slot left generating by a crash is swept when the server starts', async () => {
    const brand = await newBrand();
    const base = `/api/brands/${brand.id}/presenter-drafts`;
    const { body } = await j('POST', base, { source: 'synthetic', direction: 'someone' });
    const row = core.store.getPresenterDraft(body.id)!.json as any;
    row.views.portrait.status = 'generating';
    row.activeView = 'portrait';
    row.stage = 'drawing';
    core.store.putPresenterDraft({ id: body.id, brandId: brand.id, json: row });
    // the restart: the process goes, the library stays
    await app.drain();
    core = createCore(home);
    app = start();
    const { body: d } = await j('GET', `${base}/${body.id}`);
    expect(d.views.portrait.status).toBe('empty');
    expect(d.views.portrait.error).toMatch(/restart/);
    expect(d.activeView).toBeNull();
  });
});
