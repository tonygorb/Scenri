import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter, type GenerateRequest } from '@scenri/core';
import { loadScenes, sceneResolver, facetsOf, composePrompt, defaultScenesDir, type Scene } from '../src/scenes.js';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

const base = {
  id: 'ok',
  name: 'Ok',
  lighting: 'Flat',
  description: 'd',
  subject: 'either' as const,
  collections: ['Studio'],
  verticals: ['Home'],
  prompt: 'on a sweep',
  width: 10,
  height: 10,
};

describe('scene loader + composer', () => {
  it('loads the 62 shipped scenes, all valid, none naming a product', () => {
    const { scenes, warnings } = loadScenes(defaultScenesDir());
    expect(scenes).toHaveLength(72);
    expect(warnings).toEqual([]);
    for (const s of scenes) {
      expect(s.prompt).not.toContain('{product_name}');
      expect(s.collections.length).toBeGreaterThan(0);
      expect(s.verticals.length).toBeGreaterThan(0);
      expect(s.lighting).toBeTruthy();
    }
  });

  it('no scene prompt bakes in an invented brand or product name', () => {
    const { scenes } = loadScenes(defaultScenesDir());
    // "Capitalized Phrase — Capitalized Phrase": the shape of every leaked
    // demo-brand string found in the 2026-08-08 audit (quoted or bare, with
    // or without "&"/"Co."), e.g. "Belle Fête — Sparkling Rosé".
    const BRAND_DASH = /[A-Z][\w'.&]*(?:\s+(?:&|[A-Z][\w'.&]*)){0,3}\s+—\s+[A-Z][\w' .]+/;
    // a trigger word immediately followed by a quoted string is a named
    // label/wordmark; the same word used generically ("no wordmarks anywhere
    // in frame", "a small woven, blank neck label") is fine and must not trip
    // this — that's the false-positive case a naive keyword grep hits.
    const LABEL_QUOTE =
      /\b(labeled|label reading|wordmark|etched|embossed|stamped|engraved|stitched|neck label|fictional label)\b[^.]{0,15}["']/i;
    const offenders = scenes.filter((s) => BRAND_DASH.test(s.prompt) || LABEL_QUOTE.test(s.prompt));
    expect(offenders.map((s) => s.id)).toEqual([]);
  });

  it('rejects a scene whose prompt still names the product', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-scene-'));
    writeFileSync(
      join(dir, 'coupled.json'),
      JSON.stringify({ ...base, id: 'coupled', prompt: 'shot of {product_name} on a sweep' }),
    );
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(base));
    const { scenes, warnings } = loadScenes(dir);
    expect(scenes.map((s) => s.id)).toEqual(['ok']);
    expect(warnings).toEqual(['invalid scene skipped: coupled.json']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips broken files and bad subjects with warnings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-scene-'));
    writeFileSync(join(dir, 'bad.json'), '{nope');
    writeFileSync(join(dir, 'incomplete.json'), JSON.stringify({ id: 'x' }));
    writeFileSync(join(dir, 'subject.json'), JSON.stringify({ ...base, id: 'subject', subject: 'vibes' }));
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(base));
    const { scenes, warnings } = loadScenes(dir);
    expect(scenes.map((s) => s.id)).toEqual(['ok']);
    expect(warnings).toHaveLength(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a scene by a former id, so stored briefs keep working', () => {
    const scenes: Scene[] = [{ ...base, id: 'new-id', aliases: ['old-id'] }];
    const resolve = sceneResolver(scenes);
    expect(resolve('old-id')?.id).toBe('new-id');
    expect(resolve('new-id')?.id).toBe('new-id');
    expect(resolve('never-existed')).toBeUndefined();
  });

  it('reports the facets actually in use', () => {
    const { collections, verticals } = facetsOf(loadScenes(defaultScenesDir()).scenes);
    expect(collections).toContain('Interiors');
    expect(collections).toContain('Social');
    expect(collections).toContain('Portrait');
    expect(verticals).toContain('Beauty');
    expect(collections).toEqual([...collections].sort());
  });

  it('composePrompt fills only the copy slots and appends notes', () => {
    const s: Scene = {
      ...base,
      fields: [{ key: 'headline', label: 'H', placeholder: 'Built to move / New season' }],
      prompt: 'square frame reading {headline} in the empty third',
    };
    expect(composePrompt(s, { fields: { headline: 'Run further' } })).toBe(
      'square frame reading Run further in the empty third',
    );
    expect(composePrompt(s, {})).toBe('square frame reading Built to move in the empty third');
    expect(composePrompt(s, { notes: 'moody light' })).toMatch(/Art direction: moody light$/);
  });
});

describe('product uploads + scene generation via API', () => {
  let home: string;
  let core: Core;
  let app: FastifyInstance;
  let lastGen: GenerateRequest | null = null;

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
    generate: async (req) => {
      lastGen = req;
      return { images: [], costUsd: 0 };
    },
    edit: async () => ({ images: [], costUsd: 0 }),
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sc-scene-api-'));
    core = createCore(home);
    lastGen = null;
    app = buildServer({ core, engines: { all: () => [spy], get: (id) => (id === 'spy' ? spy : null) } });
  });
  afterEach(async () => {
    await app.close();
    core.close();
    rmSync(home, { recursive: true, force: true });
  });

  async function upload(brandId: string, kind: 'products' | 'characters', name: string): Promise<any> {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#aa2211' } })
      .png()
      .toBuffer();
    const boundary = '----btboundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="name"\r\n\r\n${name}\r\n`),
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="shot.png"\r\ncontent-type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/${kind}`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  }
  const newBrand = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();

  it('uploads a product shot into the brand kit and deletes it', async () => {
    const brand = await newBrand();
    const res = await upload(brand.id, 'products', 'House Blend');
    expect(res.statusCode).toBe(200);
    const products = res.json().json.products;
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('House Blend');
    expect(products[0].shots[0].locked).toBe(true);
    expect(products[0].shots[0].file).toMatch(/^asset:[a-f0-9]{32}$/);

    const del = await app.inject({ method: 'DELETE', url: `/api/brands/${brand.id}/products/${products[0].id}` });
    expect(del.json().json.products).toHaveLength(0);
  });

  it('has no manual-add route for characters — presenters attach straight from the catalog instead', async () => {
    const brand = await newBrand();
    const res = await upload(brand.id, 'characters', 'Marco');
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/scenes carries the facets; the deprecated alias still returns a bare list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenes' });
    const body = res.json();
    expect(body.scenes).toHaveLength(72);
    expect(body.collections).toContain('Interiors');
    expect(body.verticals).toContain('Beauty');

    const legacy = (await app.inject({ method: 'GET', url: '/api/templates' })).json();
    expect(Array.isArray(legacy)).toBe(true);
    expect(legacy).toHaveLength(72);
  });

  it('a scene id resolves through the generate route', async () => {
    const brand = await newBrand();
    const withProduct = (await upload(brand.id, 'products', 'House Blend')).json();
    const productId = withProduct.json.products[0].id;
    const proj = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: proj.project.id,
        kind: 'generation',
        engineId: 'spy',
        templateId: 'studio-polished-pedestal',
        productId,
        prompt: 'keep it airy',
      },
    });
    // Legacy prompt/templateId/productId requests now compile through the same
    // compileBrief every brief uses, instead of a second hand-written framing
    // that produced a "[Scene Name] … Art direction: …" shape nothing else in
    // the product emitted. The scene, the product and the free text all still
    // reach the model — via one code path now, not two that could drift.
    expect(res.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(lastGen!.prompt).toContain('House Blend');
    expect(lastGen!.prompt).toContain('monumental quarry scale dwarfing the subject');
    expect(lastGen!.prompt).toContain('keep it airy');
    expect(lastGen!.prompt).toContain('preserve its label, shape and colors');
    expect(lastGen!.width).toBe(1024);
    expect(lastGen!.referenceImages).toHaveLength(1);
    expect(lastGen!.referenceRoles).toEqual(['product']);
  });

  it('a product scene without a product warns but still runs; an unknown scene is refused', async () => {
    const brand = await newBrand();
    const proj = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } })
    ).json();
    const noProd = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: proj.project.id,
        kind: 'generation',
        engineId: 'spy',
        templateId: 'studio-polished-pedestal',
      },
    });
    // Scene-only is a legitimate state: the user may want the environment on
    // its own. The legacy path hard-refused this while the compiler only
    // warned — the two disagreed. Unified on the compiler's behaviour, which
    // keeps every chip optional rather than making the system depend on all
    // of them being populated.
    expect(noProd.statusCode).toBe(202);
    expect(noProd.json().warnings ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/built around a product/i)]),
    );
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: proj.project.id, kind: 'generation', engineId: 'spy', templateId: 'nope' },
    });
    expect(unknown.statusCode).toBe(400);
  });

  it("lists a scene's reference frames, and answers empty rather than 404 when there is no set", async () => {
    const withSet = (await app.inject({ method: 'GET', url: '/api/scene-previews/morning-tabletop' })).json();
    expect(withSet.frames.length).toBeGreaterThan(0);
    expect(withSet.frames[0]).toMatch(/^\/api\/scene-previews\/morning-tabletop\/ref-\d\d\.jpg\?v=\d+$/);

    const without = await app.inject({ method: 'GET', url: '/api/scene-previews/no-such-scene' });
    expect(without.statusCode).toBe(200);
    expect(without.json().frames).toEqual([]);

    // an id outside the pattern never reaches the filesystem; a traversal is
    // refused earlier still, by the router itself
    expect((await app.inject({ method: 'GET', url: '/api/scene-previews/Not_An_Id' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/scene-previews/../../etc' })).statusCode).toBe(404);
  });

  it('reports where the library lives and how big it is', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/home' });
    const body = res.json();
    expect(body.dir).toBe(home);
    expect(body.dbPath).toContain('scenri.db');
    expect(typeof body.bytes).toBe('number');
  });

  it('exports the whole library as a zip, and never the keys', async () => {
    const brand = await newBrand();
    await upload(brand.id, 'products', 'House Blend');
    const res = await app.inject({ method: 'GET', url: '/api/export/all' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const body = res.rawPayload.toString('latin1');
    expect(body).toContain('brands.json');
    expect(body).not.toContain('config.json');
  });

  it('refuses a delete without a known scope', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/data?scope=everything-please' });
    expect(res.statusCode).toBe(400);
  });

  it('deleting shots drops the projects and keeps the brand', async () => {
    const brand = await newBrand();
    await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } });
    expect((await app.inject({ method: 'GET', url: `/api/projects?brandId=${brand.id}` })).json()).toHaveLength(1);

    const res = await app.inject({ method: 'DELETE', url: '/api/data?scope=shots' });
    expect(res.json().ok).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/api/projects?brandId=${brand.id}` })).json()).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/api/brands' })).json()).toHaveLength(1);
  });
});
