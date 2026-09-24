import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { createDemoAnalyzer, createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { loadDemoProducts } from '../src/demoProducts.js';
import { loadPresenters } from '../src/presenters.js';
import { angleFor, handsStaged, pickSubject, rolesFor } from '../src/sceneExamples.js';
import { drainTracked, track } from './servers.js';

describe('who stands in a scene’s examples', () => {
  const products = [
    { id: 'ring', category: 'jewelry' },
    { id: 'vial', category: 'fragrance' },
    { id: 'serum', category: 'beauty' },
    { id: 'chair', category: 'furniture' },
    { id: 'bread', category: 'food' },
    { id: 'soda', category: 'beverage' },
    { id: 'voss-rowe-ridgeline-trail', category: 'footwear' },
    { id: 'camera', category: 'electronics' },
  ];
  const people = [
    { id: 'astrid', suitableCategories: ['Fragrance', 'Beauty'] },
    { id: 'theo', suitableCategories: ['Sport', 'Footwear'] },
  ];
  const scene = (over: Record<string, unknown> = {}) =>
    ({ id: 'my-hall', subject: 'either', ...over }) as Parameters<typeof pickSubject>[0];

  it("takes a demo product from the scene's own categories", () => {
    expect(pickSubject(scene({ verticals: ['Jewelry'] }), products, people)).toEqual({ kind: 'product', id: 'ring' });
    expect(pickSubject(scene({ verticals: ['Home'] }), products, people)).toEqual({ kind: 'product', id: 'chair' });
    expect(pickSubject(scene({ verticals: ['Sport'] }), products, people)).toEqual({
      kind: 'product',
      id: 'voss-rowe-ridgeline-trail',
    });
    const food = pickSubject(scene({ verticals: ['Food & drink'] }), products, people);
    expect(['bread', 'soda']).toContain(food?.id);
  });

  it('falls back to the small everyday objects when the scene names no category', () => {
    for (const verticals of [undefined, [], ['Automotive']]) {
      const got = pickSubject(scene({ verticals }), products, people);
      expect(['vial', 'serum'], String(verticals)).toContain(got?.id);
    }
  });

  it('is the same subject every time for the same scene, and not the same for every scene', () => {
    const a = pickSubject(scene({ verticals: ['Fragrance', 'Beauty'] }), products, people);
    for (let i = 0; i < 5; i++)
      expect(pickSubject(scene({ verticals: ['Fragrance', 'Beauty'] }), products, people)).toEqual(a);
    const picks = new Set(
      Array.from(
        { length: 20 },
        (_, i) => pickSubject(scene({ id: `s${i}`, verticals: ['Fragrance', 'Beauty'] }), products, people)?.id,
      ),
    );
    expect(picks.size).toBe(2);
  });

  it('a world built around a person gets a demo presenter who suits it', () => {
    expect(pickSubject(scene({ subject: 'person', verticals: ['Sport'] }), products, people)).toEqual({
      kind: 'presenter',
      id: 'theo',
    });
    expect(pickSubject(scene({ figure: 'a swimmer', verticals: ['Beauty'] }), products, people)).toEqual({
      kind: 'presenter',
      id: 'astrid',
    });
    // nobody suits it: still somebody
    expect(pickSubject(scene({ subject: 'person', verticals: ['Electronics'] }), products, people)?.kind).toBe(
      'presenter',
    );
    expect(pickSubject(scene({ subject: 'person' }), products, [])).toBeNull();
    expect(pickSubject(scene(), [], people)).toBeNull();
  });

  it("every category a shipped scene uses finds a subject in Scenri's own library", () => {
    const { demoProducts } = loadDemoProducts();
    const { presenters } = loadPresenters();
    const verticals = [
      'Accessories',
      'Apparel',
      'Beauty',
      'Beverage',
      'Electronics',
      'Food & drink',
      'Footwear',
      'Fragrance',
      'Furniture',
      'Home',
      'Jewelry',
      'Sport',
    ];
    for (const v of verticals) {
      const got = pickSubject(scene({ verticals: [v] }), demoProducts, presenters);
      const product = demoProducts.find((p) => p.id === got?.id);
      expect(product, v).toBeTruthy();
      // a category of its own, never the fallback, for every category the catalog stocks
      if (v !== 'Sport' && v !== 'Home' && v !== 'Food & drink') expect(product?.category, v).toBe(v.toLowerCase());
    }
  });

  it("a place staged in someone's hands is offered two more: its hero is already held", () => {
    const product = { kind: 'product' as const, id: 'x' };
    expect(rolesFor(product, 'more', 'A stone ledge, held in a pair of anonymous hands, no face')).toEqual([
      'angle',
      'bold',
    ]);
    for (const p of ["A tray a hand's width across", 'Hand-painted tiles', 'A bench, no hands in frame', 'hands-free'])
      expect(rolesFor(product, 'more', p), p).toEqual(['hands', 'angle', 'bold']);
    expect(handsStaged(undefined)).toBe(false);
  });

  it('asks for three more with a product, two with a person, and looks down on a tabletop', () => {
    expect(rolesFor({ kind: 'product', id: 'x' }, 'auto')).toEqual(['hero', 'close']);
    expect(rolesFor({ kind: 'product', id: 'x' }, 'more')).toEqual(['hands', 'angle', 'bold']);
    expect(rolesFor({ kind: 'presenter', id: 'x' }, 'more')).toEqual(['angle', 'bold']);
    expect(angleFor({ prompt: 'A walnut tabletop under a north window' })).toBe('top-down');
    expect(angleFor({ prompt: 'A brutalist hall of board-formed concrete' })).toBe('ground');
  });
});

/* ------------------------------------------------------------ the run */

let home: string;
let templatesDir: string;
let core: Core;
const env = process.env.SCENRI_DEMO_BUILDS;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-examples-'));
  templatesDir = mkdtempSync(join(tmpdir(), 'sc-examples-templates-'));
  core = createCore(home);
  // the demo engine draws placeholders, which the studio refuses unless told
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

/** The demo engine with every call written down, and an edit that can be held open. */
function spied(costUsd: number) {
  const demo = createDemoEngine((b: Buffer) => core.images.save(b), { maxReferenceImages: 4 });
  const calls = { generate: [] as any[], edit: [] as any[] };
  const gate = { hold: null as null | ((n: number) => boolean), open: () => {} };
  const engine: EngineAdapter = {
    ...demo,
    capabilities: () => demo.capabilities(),
    costEstimate: async () => costUsd,
    generate: (req, signal, onImage) => {
      calls.generate.push(req);
      return demo.generate(req, signal, onImage);
    },
    edit: async (req, signal) => {
      calls.edit.push(req);
      if (gate.hold?.(calls.edit.length)) {
        await new Promise<void>((resolve, reject) => {
          gate.open = resolve;
          signal?.addEventListener('abort', () => reject(new Error('cancelled')));
        });
      }
      const r = await demo.edit(req, signal);
      // the demo engine answers the same edit with the same bytes; a real one never does
      return { ...r, images: [core.images.save(await png(20 + calls.edit.length * 9))] };
    },
  };
  return { engine, calls, gate };
}

async function setup(costUsd = 0, library = true) {
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
  if (library) {
    const refDir = join(templatesDir, 'previews', 'demo-products', 'vial');
    mkdirSync(refDir, { recursive: true });
    writeFileSync(
      join(refDir, 'three-quarter.jpg'),
      await sharp(await png(40))
        .jpeg()
        .toBuffer(),
    );
  }

  const { engine, calls, gate } = spied(costUsd);
  const app = track(
    buildServer({
      core,
      engines: { all: () => [engine], get: (id: string) => (id === 'demo' ? engine : null) },
      sizeReader: createDemoAnalyzer(),
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
  const place = core.images.save(await png(160));
  const url = (sceneId: string, rest = '') => `/api/brands/${brand.id}/scenes/${sceneId}/examples${rest}`;
  const sceneOf = (id: string) => (core.store.getBrand(brand.id)?.json as any)?.scenes.find((s: any) => s.id === id);
  const status = async (id: string) => (await app.inject({ method: 'GET', url: url(id) })).json();
  const settled = async (id: string) => {
    // by the clock, not a count: a cold first run (sharp, the demo pictures) is slow
    for (const until = Date.now() + 20_000; Date.now() < until; ) {
      const { job } = await status(id);
      if (job && job.status !== 'running') return job;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('the examples never settled');
  };
  /** A saved scene with its place picture: the road Use this scene takes. */
  const makeScene = async (over: Record<string, unknown> = {}) =>
    (
      await app.inject({
        method: 'POST',
        url: `/api/brands/${brand.id}/scenes`,
        payload: {
          name: 'Concrete Hall',
          prompt: 'A minimal brutalist hall of raw board-formed concrete.',
          lighting: 'One hard raking side light',
          previewHash: place,
          ...over,
        },
      })
    ).json().scene.id as string;
  /** The press that asks for the place in use. Nothing here draws without it. */
  const press = async (id: string) => app.inject({ method: 'POST', url: url(id), payload: { first: true } });
  /** Saved, asked for, and finished: what every test that needs a set starts from. */
  const drawn = async (id: string) => {
    await press(id);
    return settled(id);
  };
  return {
    app,
    calls,
    gate,
    brandId: brand.id as string,
    place,
    url,
    sceneOf,
    status,
    settled,
    makeScene,
    press,
    drawn,
  };
}

const hashOf = (ref: string) => ref.slice('asset:'.length);

describe("a scene's examples", { timeout: 30_000 }, () => {
  it('draw the hero at the product’s own scale and the close-up from it, once, when they are asked for', async () => {
    const { app, brandId, calls, place, sceneOf, makeScene, status, drawn, url } = await setup();
    const id = await makeScene();
    // saving spends nothing: no run, no call, and the two are offered instead
    expect((await status(id)).job).toBeNull();
    expect((await status(id)).first).toEqual(['hero', 'close']);
    expect(calls.generate).toHaveLength(0);
    expect(calls.edit).toHaveLength(0);

    const job = await drawn(id);
    expect(job.status).toBe('done');
    expect(job.done).toEqual(['hero', 'close']);

    // the hero: a plate drawn from the place's picture, then the vial placed on it
    expect(calls.generate).toHaveLength(1);
    expect(calls.generate[0].referenceImages).toEqual([core.images.pathFor(place)]);
    expect(calls.generate[0].prompt).toContain('spans only about 40 centimetres');
    expect(calls.edit[0].instruction).toContain("about a quarter of the frame's width");
    // the close-up: an edit of that hero, never a fresh draw of the place
    expect(calls.edit).toHaveLength(2);
    const examples = sceneOf(id).examples;
    expect(examples.map((e: any) => e.role)).toEqual(['hero', 'close']);
    expect(calls.edit[1].sourceImage).toBe(core.images.pathFor(hashOf(examples[0].file)));
    expect(calls.edit[1].instruction).toContain('move the camera in close on a glass perfume vial');
    expect(examples.every((e: any) => e.from === `asset:${place}` && e.product === 'vial')).toBe(true);
    expect(examples[1].setup).toBe('close');

    // a later edit of the scene's words redraws nothing by itself
    await app.inject({ method: 'PATCH', url: `/api/brands/${brandId}/scenes/${id}`, payload: { name: 'Hall' } });
    expect((await app.inject({ method: 'GET', url: url(id) })).json().job.id).toBe(job.id);
    expect(calls.generate).toHaveLength(1);
    // and with the set standing on this picture there is nothing left to offer
    expect((await status(id)).first).toEqual([]);
  });

  it('Add three more draws hands, another angle and a bold one, and tells the page first', async () => {
    const { app, sceneOf, settled, makeScene, url, status, drawn } = await setup();
    const id = await makeScene();
    await drawn(id);
    expect((await status(id)).more).toEqual(['hands', 'angle', 'bold']);
    const res = await app.inject({ method: 'POST', url: url(id), payload: { more: true } });
    expect(res.statusCode).toBe(200);
    const job = await settled(id);
    expect(job.done).toEqual(['hands', 'angle', 'bold']);
    expect(sceneOf(id).examples.map((e: any) => e.role)).toEqual(['hero', 'close', 'hands', 'angle', 'bold']);
    expect(sceneOf(id).examples.find((e: any) => e.role === 'angle').setup).toBe('ground');
  });

  it('Try again replaces one example and lets the old picture go', async () => {
    const { app, sceneOf, settled, makeScene, url, drawn } = await setup();
    const id = await makeScene();
    await drawn(id);
    const before = hashOf(sceneOf(id).examples.find((e: any) => e.role === 'close').file);
    await app.inject({ method: 'POST', url: url(id), payload: { roles: ['close'] } });
    const job = await settled(id);
    expect(job.roles).toEqual(['close']);
    const after = hashOf(sceneOf(id).examples.find((e: any) => e.role === 'close').file);
    expect(after).not.toBe(before);
    expect(core.images.has(before)).toBe(false);
    expect(sceneOf(id).examples).toHaveLength(2);
  });

  it('Stop keeps what landed and draws nothing more', async () => {
    const { app, gate, sceneOf, settled, makeScene, url, status, press } = await setup();
    // the second edit is the close-up: hold it open
    gate.hold = (n) => n === 2;
    const id = await makeScene();
    await press(id);
    for (const until = Date.now() + 20_000; Date.now() < until && (await status(id)).job?.current !== 'close'; )
      await new Promise((r) => setTimeout(r, 10));
    expect((await app.inject({ method: 'POST', url: url(id, '/stop') })).json()).toEqual({ ok: true });
    const job = await settled(id);
    expect(job.status).toBe('cancelled');
    expect(sceneOf(id).examples.map((e: any) => e.role)).toEqual(['hero']);
  });

  it('a place that changed while drawing stops that run, and draws nothing in its place', async () => {
    const { app, brandId, calls, gate, place, sceneOf, settled, makeScene, status, press } = await setup();
    gate.hold = (n) => n === 2;
    const id = await makeScene();
    await press(id);
    for (const until = Date.now() + 20_000; Date.now() < until && (await status(id)).job?.current !== 'close'; )
      await new Promise((r) => setTimeout(r, 10));
    const spent = calls.generate.length + calls.edit.length;
    const next = core.images.save(await png(90));
    await app.inject({ method: 'PATCH', url: `/api/brands/${brandId}/scenes/${id}`, payload: { previewHash: next } });
    gate.hold = null;
    const job = await settled(id);
    // the run is stopped, because what it would land shows a place this scene
    // no longer has. Nothing is drawn to replace it.
    expect(job.status).toBe('cancelled');
    expect(job.from).toBe(`asset:${place}`);
    expect(calls.generate.length + calls.edit.length).toBe(spent);
    // the hero it did land stays, said to show the place as it was before
    expect(sceneOf(id).examples.map((e: any) => e.role)).toEqual(['hero']);
    expect(sceneOf(id).examples[0].from).toBe(`asset:${place}`);
    // and that is what the offer now counts
    expect((await status(id)).first).toEqual(['hero']);
  });

  it('a new place picture redraws nothing until it is asked for, and then only the roles it had', async () => {
    const { app, brandId, calls, place, sceneOf, settled, makeScene, status, url, drawn, press } = await setup();
    const id = await makeScene();
    await drawn(id);
    await app.inject({ method: 'DELETE', url: url(id, '/close') });
    const before = calls.generate.length + calls.edit.length;
    const next = core.images.save(await png(90));
    await app.inject({ method: 'PATCH', url: `/api/brands/${brandId}/scenes/${id}`, payload: { previewHash: next } });
    // saving the new picture spends nothing: the set it had stays as it is
    expect((await status(id)).job.status).toBe('done');
    expect(calls.generate.length + calls.edit.length).toBe(before);
    expect(sceneOf(id).examples.map((e: any) => [e.role, e.from])).toEqual([['hero', `asset:${place}`]]);
    // asked for, it redraws the one role it had and no other
    expect((await status(id)).first).toEqual(['hero']);
    await press(id);
    const job = await settled(id);
    expect(job.roles).toEqual(['hero']);
    expect(sceneOf(id).examples.map((e: any) => [e.role, e.from])).toEqual([['hero', `asset:${next}`]]);
    expect(calls.generate.length + calls.edit.length).toBeGreaterThan(before);
  });

  it('removing one lets its picture go; deleting the scene lets them all go', async () => {
    const { app, brandId, sceneOf, makeScene, url, drawn } = await setup();
    const id = await makeScene();
    await drawn(id);
    const [hero, close] = sceneOf(id).examples.map((e: any) => hashOf(e.file));
    const removed = await app.inject({ method: 'DELETE', url: url(id, '/close') });
    expect(removed.json().ok).toBe(true);
    expect(core.images.has(close)).toBe(false);
    expect(sceneOf(id).examples.map((e: any) => e.role)).toEqual(['hero']);

    await app.inject({ method: 'DELETE', url: `/api/brands/${brandId}/scenes/${id}` });
    expect(core.images.has(hero)).toBe(false);
    expect((await app.inject({ method: 'GET', url: url(id) })).statusCode).toBe(404);
  });

  it("without Scenri's library nothing starts, nothing is offered, and asking says why", async () => {
    const { app, calls, makeScene, status, url } = await setup(0, false);
    const id = await makeScene();
    expect((await status(id)).job).toBeNull();
    expect((await status(id)).first).toEqual([]);
    expect((await status(id)).more).toEqual([]);
    const asked = await app.inject({ method: 'POST', url: url(id), payload: { roles: ['hero', 'close'] } });
    expect(asked.statusCode).toBe(409);
    expect(asked.json().error).toContain("Scenri's library has not downloaded yet");
    expect(calls.generate).toHaveLength(0);
    expect(calls.edit).toHaveLength(0);
  });

  it('the spend cap is asked before anything is drawn', async () => {
    const { calls, makeScene, drawn } = await setup(0.3);
    // the hero alone is two draws, 0.6, against a 0.5 cap
    core.ledger.setCap('demo', 0.5);
    const id = await makeScene();
    const job = await drawn(id);
    expect(job.status).toBe('failed');
    expect(calls.generate).toHaveLength(0);
    expect(calls.edit).toHaveLength(0);
  });

  it('shows in Activity while it draws, with how far it has got', async () => {
    const { app, brandId, gate, makeScene, status, settled, press } = await setup();
    gate.hold = (n) => n === 2;
    const id = await makeScene();
    await press(id);
    for (const until = Date.now() + 20_000; Date.now() < until && (await status(id)).job?.current !== 'close'; )
      await new Promise((r) => setTimeout(r, 10));
    const activity = (await app.inject({ method: 'GET', url: `/api/brands/${brandId}/activity` })).json();
    const row = (activity.studio ?? activity.work ?? []).find((w: any) => w.kind === 'examples');
    expect(row).toMatchObject({
      status: 'running',
      step: 'close',
      sceneId: id,
      done: 1,
      total: 2,
      name: 'Concrete Hall',
    });
    gate.open();
    await settled(id);
  });
});
