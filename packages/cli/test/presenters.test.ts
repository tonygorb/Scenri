import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { loadPresenters, presenterResolver, presenterFacetsOf, type Presenter } from '../src/presenters.js';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

const base: Presenter = {
  id: 'ok',
  name: 'Ok',
  presentation: 'woman',
  descriptor: 'd',
  ageRange: '20s',
  facial: 'f',
  skin: 's',
  hair: 'h',
  build: 'b',
  wardrobeDefault: 'w',
  suitableCategories: ['Beauty'],
  suitableStyles: ['Editorial'],
  identityNotes: 'n',
  negativeConstraints: ['x'],
  width: 10,
  height: 10,
};

describe('presenter loader', () => {
  it('loads valid presenters and skips bad files with a warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-presenter-'));
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(base));
    writeFileSync(join(dir, 'bad.json'), '{nope');
    writeFileSync(join(dir, 'incomplete.json'), JSON.stringify({ id: 'x' }));
    writeFileSync(
      join(dir, 'presentation.json'),
      JSON.stringify({ ...base, id: 'presentation', presentation: 'vibes' }),
    );
    const { presenters, warnings } = loadPresenters(dir);
    expect(presenters.map((p) => p.id)).toEqual(['ok']);
    expect(warnings).toHaveLength(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves by id, and answers undefined for an unknown one', () => {
    const resolve = presenterResolver([base]);
    expect(resolve('ok')?.name).toBe('Ok');
    expect(resolve('never-existed')).toBeUndefined();
  });

  it('reports the categories and styles actually in use, sorted', () => {
    const { categories, styles } = presenterFacetsOf([
      base,
      { ...base, id: 'two', suitableCategories: ['Apparel'], suitableStyles: ['Lifestyle'] },
    ]);
    expect(categories).toEqual(['Apparel', 'Beauty']);
    expect(styles).toEqual(['Editorial', 'Lifestyle']);
  });
});

describe('presenter catalog + cast-to-roster API', () => {
  let templatesDir: string;
  let home: string;
  let core: Core;
  let app: FastifyInstance;

  const spy: EngineAdapter = {
    capabilities: () => ({
      id: 'spy',
      displayName: 'Spy',
      localOnly: false,
      supportsEdit: true,
      supportsMask: false,
      maxReferenceImages: 2,
    }),
    isAvailable: async () => ({ ok: true }),
    costEstimate: async () => 0,
    generate: async () => ({ images: [], costUsd: 0 }),
    edit: async () => ({ images: [], costUsd: 0 }),
  };

  beforeEach(async () => {
    templatesDir = mkdtempSync(join(tmpdir(), 'sc-presenter-templates-'));
    mkdirSync(join(templatesDir, 'presenters'), { recursive: true });
    writeFileSync(join(templatesDir, 'presenters', 'sana.json'), JSON.stringify({ ...base, id: 'sana', name: 'Sana' }));

    const refDir = join(templatesDir, 'previews', 'presenters', 'sana');
    mkdirSync(refDir, { recursive: true });
    const jpg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#334455' } })
      .jpeg()
      .toBuffer();
    writeFileSync(join(refDir, 'ref-01.jpg'), jpg);
    writeFileSync(join(refDir, 'ref-02.jpg'), jpg);
    writeFileSync(join(templatesDir, 'previews', 'presenters', 'sana.jpg'), jpg);

    home = mkdtempSync(join(tmpdir(), 'sc-presenter-home-'));
    core = createCore(home);
    app = buildServer({
      core,
      engines: { all: () => [spy], get: (id) => (id === 'spy' ? spy : null) },
      templatesDir,
    });
  });

  afterEach(async () => {
    await app.close();
    core.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(templatesDir, { recursive: true, force: true });
  });

  const newBrand = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();

  it('lists the catalog with facets and a thumbnail url', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/presenters' });
    const body = res.json();
    expect(body.presenters).toHaveLength(1);
    expect(body.presenters[0].name).toBe('Sana');
    expect(body.presenters[0].previewUrl).toMatch(/^\/api\/presenter-thumbnails\/sana\.jpg\?v=\d+$/);
    expect(body.categories).toContain('Beauty');
    expect(body.styles).toContain('Editorial');
  });

  it('serves the thumbnail and 404s an unknown one', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/presenter-thumbnails/sana.jpg' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    const missing = await app.inject({ method: 'GET', url: '/api/presenter-thumbnails/nope.jpg' });
    expect(missing.statusCode).toBe(404);
  });

  it("lists a presenter's reference frames, and answers empty rather than 404 for one with no set", async () => {
    const withSet = (await app.inject({ method: 'GET', url: '/api/presenter-previews/sana' })).json();
    expect(withSet.frames).toHaveLength(2);
    expect(withSet.frames[0]).toMatch(/^\/api\/presenter-previews\/sana\/ref-01\.jpg\?v=\d+$/);
    expect(withSet.frames[1]).toMatch(/^\/api\/presenter-previews\/sana\/ref-02\.jpg\?v=\d+$/);
    const frame = await app.inject({ method: 'GET', url: '/api/presenter-previews/sana/ref-01.jpg' });
    expect(frame.statusCode).toBe(200);

    const without = await app.inject({ method: 'GET', url: '/api/presenter-previews/no-such-presenter' });
    expect(without.statusCode).toBe(200);
    expect(without.json().frames).toEqual([]);
  });

  it('adds a presenter to a brand roster with angle-labeled locked shots, and casting twice is idempotent', async () => {
    const brand = await newBrand();
    const res = await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/presenters/sana/cast` });
    expect(res.statusCode).toBe(200);
    const chars = res.json().json.characters;
    expect(chars).toHaveLength(1);
    expect(chars[0].name).toBe('Sana');
    expect(chars[0].presenterId).toBe('sana');
    expect(chars[0].shots).toEqual([
      { file: expect.stringMatching(/^asset:[a-f0-9]{32}$/), angle: 'front', locked: true },
      { file: expect.stringMatching(/^asset:[a-f0-9]{32}$/), angle: 'left-profile', locked: true },
    ]);

    const again = await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/presenters/sana/cast` });
    expect(again.json().json.characters).toHaveLength(1);
  });

  it('refuses an unknown presenter or brand', async () => {
    const brand = await newBrand();
    const unknownPresenter = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/presenters/nope/cast`,
    });
    expect(unknownPresenter.statusCode).toBe(404);

    const unknownBrand = await app.inject({ method: 'POST', url: '/api/brands/nope/presenters/sana/cast' });
    expect(unknownBrand.statusCode).toBe(404);
  });
});
