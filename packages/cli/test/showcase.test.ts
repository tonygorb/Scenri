import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { loadShowcase, showcaseFacetsOf, defaultShowcaseDir, type ShowcaseEntry } from '../src/showcase.js';
import { loadScenes, defaultScenesDir } from '../src/scenes.js';
import { loadDemoProducts, defaultDemoProductsDir } from '../src/demoProducts.js';
import { loadPresenters, defaultPresentersDir } from '../src/presenters.js';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

const base: ShowcaseEntry = {
  id: 'ok',
  title: 'Ok',
  category: 'beauty',
  brief: { tokens: [{ t: 'text', v: 'a shot' }] },
  width: 10,
  height: 10,
};

describe('showcase loader', () => {
  it('loads valid entries and skips bad files with a warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-showcase-'));
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(base));
    writeFileSync(join(dir, 'bad.json'), '{nope');
    writeFileSync(join(dir, 'incomplete.json'), JSON.stringify({ id: 'x' }));
    writeFileSync(
      join(dir, 'badtoken.json'),
      JSON.stringify({ ...base, id: 'badtoken', brief: { tokens: [{ t: 'nonsense' }] } }),
    );
    const { showcase, warnings } = loadShowcase(dir);
    expect(showcase.map((s) => s.id)).toEqual(['ok']);
    expect(warnings).toHaveLength(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports the categories actually in use, sorted', () => {
    const { categories } = showcaseFacetsOf([base, { ...base, id: 'two', category: 'footwear' }]);
    expect(categories).toEqual(['beauty', 'footwear']);
  });

  it('sorts by curated order, unordered entries last, ties by id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-showcase-order-'));
    // Filenames chosen so alphabetical readdir order is the REVERSE of the
    // curated order — proves the sort comes from `order`, not the fs.
    writeFileSync(join(dir, 'aaa.json'), JSON.stringify({ ...base, id: 'aaa', order: 2 }));
    writeFileSync(join(dir, 'bbb.json'), JSON.stringify({ ...base, id: 'bbb', order: 1 }));
    writeFileSync(join(dir, 'ccc.json'), JSON.stringify({ ...base, id: 'ccc' }));
    const { showcase } = loadShowcase(dir);
    expect(showcase.map((s) => s.id)).toEqual(['bbb', 'aaa', 'ccc']);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('showcase catalog API', () => {
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
    templatesDir = mkdtempSync(join(tmpdir(), 'sc-showcase-templates-'));
    mkdirSync(join(templatesDir, 'showcase'), { recursive: true });
    writeFileSync(
      join(templatesDir, 'showcase', 'amber-serum.json'),
      JSON.stringify({ ...base, id: 'amber-serum', title: 'Amber Serum on Salt Flat' }),
    );
    mkdirSync(join(templatesDir, 'previews', 'showcase'), { recursive: true });
    const jpg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffddaa' } })
      .jpeg()
      .toBuffer();
    writeFileSync(join(templatesDir, 'previews', 'showcase', 'amber-serum.jpg'), jpg);

    home = mkdtempSync(join(tmpdir(), 'sc-showcase-home-'));
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

  it('lists the catalog with facets and a preview url', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/showcase' });
    const body = res.json();
    expect(body.showcase).toHaveLength(1);
    expect(body.showcase[0].title).toBe('Amber Serum on Salt Flat');
    expect(body.showcase[0].previewUrl).toMatch(/^\/api\/showcase-previews\/amber-serum\.jpg\?v=\d+$/);
    expect(body.categories).toContain('beauty');
  });

  it('serves the preview image and 404s an unknown one', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/showcase-previews/amber-serum.jpg' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    const missing = await app.inject({ method: 'GET', url: '/api/showcase-previews/nope.jpg' });
    expect(missing.statusCode).toBe(404);
  });
});

/**
 * Referential integrity for the shipped homepage examples.
 *
 * These were the missing guardrails: nothing checked that a showcase entry's
 * scene / product / presenter ids still resolve, so scenes could be renamed
 * or replaced underneath the examples and CI stayed green while the homepage
 * advertised things that no longer existed.
 */
describe('shipped showcase entries resolve against the real catalog', () => {
  const entries = loadShowcase(defaultShowcaseDir()).showcase;
  const sceneIds = new Set(loadScenes(defaultScenesDir()).scenes.map((s) => s.id));
  const productIds = new Set(loadDemoProducts(defaultDemoProductsDir()).demoProducts.map((p) => p.id));
  const presenterIds = new Set(loadPresenters(defaultPresentersDir()).presenters.map((p) => p.id));

  const tokensOf = (e: (typeof entries)[number], kind: string) =>
    (e.brief?.tokens ?? []).filter((t: any) => t.t === kind);

  it('every entry references a scene that still exists', () => {
    const broken = entries.flatMap((e) =>
      tokensOf(e, 'template')
        .filter((t: any) => !sceneIds.has(String(t.id)))
        .map((t: any) => `${e.id} -> ${t.id}`),
    );
    expect(broken).toEqual([]);
  });

  it('every entry references a real, selectable demo product', () => {
    const broken = entries.flatMap((e) =>
      tokensOf(e, 'product')
        .filter((t: any) => !productIds.has(String(t.id)))
        .map((t: any) => `${e.id} -> ${t.id}`),
    );
    expect(broken).toEqual([]);
  });

  it('every entry that names a presenter names one on the roster', () => {
    const broken = entries.flatMap((e) =>
      tokensOf(e, 'character')
        .filter((t: any) => !presenterIds.has(String(t.id)))
        .map((t: any) => `${e.id} -> ${t.id}`),
    );
    expect(broken).toEqual([]);
  });

  it('every entry has a preview image on disk', () => {
    const missing = entries
      .filter((e) => !existsSync(join(defaultShowcaseDir(), '..', 'previews', 'showcase', `${e.id}.jpg`)))
      .map((e) => e.id);
    expect(missing).toEqual([]);
  });

  /**
   * The other half of the pairing. An orphan jpg is worse than a cosmetic
   * mismatch: generate-showcase-set.mjs skips any recipe whose jpg already
   * exists, so a hero left behind without its entry permanently blocks its own
   * tile from being rebuilt, and ships repo weight the gallery never serves.
   */
  it('every preview image on disk belongs to an entry', () => {
    const ids = new Set(entries.map((e) => e.id));
    const previewDir = join(defaultShowcaseDir(), '..', 'previews', 'showcase');
    const orphans = (existsSync(previewDir) ? readdirSync(previewDir) : [])
      .filter((f) => f.endsWith('.jpg'))
      .map((f) => f.replace(/\.jpg$/, ''))
      .filter((id) => !ids.has(id));
    expect(orphans).toEqual([]);
  });

  /**
   * Homepage thumbnails are standardized to 4:5 (portrait, 1024x1280): the
   * grid renders every tile at aspect-ratio 4/5 with object-fit cover, so any
   * other source ratio ships a composition the visitor never sees as framed.
   * In-product generation stays free — this rule binds ONLY shipped examples.
   */
  it('every entry is generated at 4:5 portrait (1024x1280)', () => {
    const offRatio = entries
      .filter((e) => e.width !== 1024 || e.height !== 1280)
      .map((e) => `${e.id} ${e.width}x${e.height}`);
    expect(offRatio).toEqual([]);
  });

  /**
   * Casting rules are mechanical, like scene verticals: a presenter may only
   * front a product whose category is inside their suitableCategories.
   * Mapping duplicated from apps/studio/src/compat.ts (the studio keeps its
   * own copy for the picker hint; this one gates shipped examples).
   */
  it('every person tile casts a presenter suited to the product category', () => {
    const CATEGORY_TO_PRESENTER_CATEGORY: Record<string, string[]> = {
      fragrance: ['Fragrance'],
      footwear: ['Footwear', 'Apparel'],
      apparel: ['Apparel', 'Fashion', 'Streetwear'],
      furniture: ['Furniture', 'Home'],
      beauty: ['Beauty', 'Wellness'],
      electronics: ['Electronics', 'Technology'],
      accessories: ['Accessories'],
      beverage: ['Beverages', 'Food & drink'],
      jewelry: ['Jewelry'],
      food: ['Beverages', 'Food & drink'],
    };
    const productList = loadDemoProducts(defaultDemoProductsDir()).demoProducts;
    const presenterList = loadPresenters(defaultPresentersDir()).presenters;
    const productCat = new Map(productList.map((p) => [p.id, p.category]));
    const presenterById = new Map(presenterList.map((p) => [p.id, p]));
    const miscast = entries.flatMap((e) => {
      const presenterId = (tokensOf(e, 'character')[0] as any)?.id as string | undefined;
      const productId = (tokensOf(e, 'product')[0] as any)?.id as string | undefined;
      if (!presenterId || !productId) return [];
      const cat = productCat.get(productId);
      const presenter = presenterById.get(presenterId);
      if (!cat || !presenter) return []; // resolution is covered by the tests above
      const aliases = CATEGORY_TO_PRESENTER_CATEGORY[cat] ?? [];
      return aliases.some((a) => presenter.suitableCategories.includes(a))
        ? []
        : [`${e.id}: ${presenterId} not suited to ${cat}`];
    });
    expect(miscast).toEqual([]);
  });
});
