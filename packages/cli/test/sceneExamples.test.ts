import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { createDemoAnalyzer, createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from '../src/server.js';
import { loadDemoProducts } from '../src/demoProducts.js';
import { loadPresenters } from '../src/presenters.js';
import {
  angleFor,
  handsStaged,
  heroBothInstruction,
  heroModeOf,
  heroPresenterInstruction,
  heroProductInstruction,
  heroWithFor,
  pickSubject,
  rolesFor,
} from '../src/sceneExamples.js';
import { resetSceneStudio } from '../src/sceneStudio.js';
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
  resetSceneStudio();
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

const png = (shade: number, width = 64, height = 80) =>
  sharp({ create: { width, height, channels: 3, background: { r: shade, g: shade, b: shade } } })
    .png()
    .toBuffer();

/** Which example an edit is for, read off its instruction (sceneExamples.ts). */
function roleOf(instruction: string): string {
  if (instruction.startsWith('input.png is this place')) return 'hero';
  if (instruction.startsWith('move the camera in close')) return 'close';
  if (instruction.startsWith('a pair of anonymous hands')) return 'hands';
  if (instruction.startsWith('the camera moves:')) return 'camera';
  return 'other';
}

/** The demo engine with every call written down, and an edit that can be held open. */
function spied(costUsd: number) {
  const demo = createDemoEngine((b: Buffer) => core.images.save(b), { maxReferenceImages: 4 });
  const calls = { generate: [] as any[], edit: [] as any[] };
  const gate = {
    hold: null as null | ((n: number) => boolean),
    open: () => {},
    /** Fail this call: the nth generate or edit. */
    fail: null as null | ((kind: 'generate' | 'edit', n: number) => boolean),
    /** The error an edit for this role throws, the nth time it is asked for, if any. */
    failRole: null as null | ((role: string, nth: number) => string | null),
    /** A held edit that does not answer Stop at once, the way a codex child takes a moment to die. */
    slowToDie: false,
    /** Copy the edit's source first, as the codex engine does, so a missing file fails the way it does there. */
    copySource: false,
    /** The size of the picture an edit hands back. */
    size: [64, 80] as [number, number],
    /** Runs as an edit is about to hand its picture back. */
    onReturn: null as null | ((role: string) => void),
    /** The role of every edit, in order. */
    roles: [] as string[],
  };
  const engine: EngineAdapter = {
    ...demo,
    capabilities: () => demo.capabilities(),
    costEstimate: async () => costUsd,
    generate: (req, signal, onImage) => {
      calls.generate.push(req);
      if (gate.fail?.('generate', calls.generate.length)) return Promise.reject(new Error('the engine fell over'));
      return demo.generate(req, signal, onImage);
    },
    edit: async (req, signal) => {
      calls.edit.push(req);
      const role = roleOf(req.instruction);
      gate.roles.push(role);
      if (gate.copySource) await copyFile(req.sourceImage, join(home, 'edit-input.png'));
      const refused = gate.failRole?.(role, gate.roles.filter((r) => r === role).length);
      if (refused) throw new Error(refused);
      if (gate.fail?.('edit', calls.edit.length)) throw new Error('the engine fell over');
      if (gate.hold?.(calls.edit.length)) {
        await new Promise<void>((resolve, reject) => {
          gate.open = resolve;
          if (!gate.slowToDie) signal?.addEventListener('abort', () => reject(new Error('cancelled')));
        });
      }
      const r = await demo.edit(req, signal);
      // the demo engine answers the same edit with the same bytes; a real one never does
      const hash = core.images.save(await png(20 + calls.edit.length * 9, ...gate.size));
      gate.onReturn?.(role);
      return { ...r, images: [hash] };
    },
  };
  return { engine, calls, gate };
}

const VIAL = {
  id: 'vial',
  name: 'Vial',
  promptName: 'a glass perfume vial',
  category: 'fragrance',
  description: 'A glass perfume vial.',
  width: 10,
  height: 10,
};
/** A stand-in large enough that no example takes the small-product plate path: every example is one edit. */
const LAMP = {
  id: 'lamp',
  name: 'Lamp',
  promptName: 'a tall brass floor lamp',
  category: 'fragrance',
  description: 'A tall brass floor lamp.',
  dimensions: '40 x 40 x 170 cm',
  width: 10,
  height: 10,
};

async function setup(costUsd = 0, library = true, opts: { presenter?: boolean; lamp?: boolean } = {}) {
  const product = opts.lamp ? LAMP : VIAL;
  mkdirSync(join(templatesDir, 'demo-products'), { recursive: true });
  writeFileSync(join(templatesDir, 'demo-products', `${product.id}.json`), JSON.stringify(product));
  if (library) {
    const refDir = join(templatesDir, 'previews', 'demo-products', product.id);
    mkdirSync(refDir, { recursive: true });
    writeFileSync(
      join(refDir, 'three-quarter.jpg'),
      await sharp(await png(40))
        .jpeg()
        .toBuffer(),
    );
  }

  if (opts.presenter) {
    // one demo presenter, as the catalog files one: the record and two of their pictures
    mkdirSync(join(templatesDir, 'presenters'), { recursive: true });
    writeFileSync(
      join(templatesDir, 'presenters', 'amara.json'),
      JSON.stringify({
        id: 'amara',
        name: 'Amara',
        presentation: 'woman',
        descriptor: 'Editorial',
        ageRange: 'mid 20s',
        facial: 'sculpted high cheekbones',
        skin: 'deep brown',
        hair: 'a close-cropped buzz cut',
        build: 'tall and lean',
        wardrobeDefault: 'a black slip dress',
        suitableCategories: ['Fragrance'],
        suitableStyles: ['Editorial'],
        identityNotes: 'the buzz cut must survive every generation',
        negativeConstraints: [],
        width: 1024,
        height: 1280,
      }),
    );
    const views = join(templatesDir, 'previews', 'presenters', 'amara');
    mkdirSync(views, { recursive: true });
    for (const [slot, shade] of [
      ['avatar', 70],
      ['front', 80],
    ] as const)
      writeFileSync(
        join(views, `${slot}.jpg`),
        await sharp(await png(shade))
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
      // the studio reads its words with the demo reader: what the hero shows follows them
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
  const studioUrl = `/api/brands/${brand.id}/scene-studio/jobs`;
  /** One piece of studio work, run to its end. */
  const studio = async (payload: Record<string, unknown>) => {
    const started = await app.inject({
      method: 'POST',
      url: studioUrl,
      payload: { kind: 'make', conversation: 'convo-1', ...payload },
    });
    if (started.statusCode !== 200) throw new Error(started.body);
    const { jobId } = started.json();
    for (const until = Date.now() + 20_000; Date.now() < until; ) {
      const job = (await app.inject({ method: 'GET', url: `${studioUrl}/${jobId}` })).json();
      if (job.status !== 'running') return job;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('the studio never finished');
  };
  /** Saved, asked for, and finished: what every test that needs a set starts from. */
  const drawn = async (id: string) => {
    await press(id);
    return settled(id);
  };
  /** Until the run is drawing this role. */
  const drawing = async (id: string, role: string) => {
    for (const until = Date.now() + 20_000; Date.now() < until; ) {
      if ((await status(id)).job?.current === role) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`${role} never started`);
  };
  const ask = (id: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: url(id), payload });
  /** What Activity says about the brand's studio work, and so what a toast says. */
  const activity = async () =>
    (await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/activity` })).json().studio as any[];
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
    drawing,
    ask,
    activity,
    studio,
    studioUrl,
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

// An anchor may keep what its references staged, made nobody's: a figure, a
// plain object held as the hero. Told `this place, empty` over one, an
// example came out with two people or two products.
describe('the hero drawn into an anchor', () => {
  it('names the stand-in the product or the presenter takes the place of', () => {
    expect(heroProductInstruction('Tide Serum', null, [])).toContain('input.png is this place, empty.');
    const product = heroProductInstruction('Tide Serum', null, [], true);
    expect(product).not.toContain('empty');
    expect(product).toContain('only marks where the product goes, and gives way to it');
    expect(heroPresenterInstruction('')).toContain('input.png is this place, empty.');
    const person = heroPresenterInstruction('', true);
    expect(person).toContain('Any person in it is a stand-in');
    expect(person).toContain('Add no other person');
  });
});

describe('what a scene’s hero shows', () => {
  const products = [
    { id: 'vial', category: 'fragrance' },
    { id: 'chair', category: 'furniture' },
  ];
  const people = [{ id: 'amara', suitableCategories: ['Fragrance'] }];

  it('is the reader’s answer, and otherwise follows the figure and what the pictures held', () => {
    // the representative worlds, as the reader would read them
    const worlds: [string, Parameters<typeof heroModeOf>[0], string][] = [
      ['a product studio', { subject: 'product', hero: 'product' }, 'product'],
      [
        'a fashion editorial place',
        { subject: 'person', figure: 'one person at full length', hero: 'presenter' },
        'presenter',
      ],
      ['a lifestyle moment', { figure: 'one person at the table', holds: ['person', 'product'], hero: 'both' }, 'both'],
      ['an architectural space that is the point', { subject: 'either', hero: 'place' }, 'place'],
      ['a typographic poster world', { subject: 'either', holds: ['lettering'], hero: 'product' }, 'product'],
      ['a surreal graphic set', { subject: 'either', hero: 'product' }, 'product'],
      ['a minimal clean studio', { subject: 'product', hero: 'product' }, 'product'],
      ['a vast landscape nothing should enter', { subject: 'either', hero: 'place' }, 'place'],
    ];
    for (const [, reading, mode] of worlds) expect(heroModeOf(reading)).toBe(mode);
    // with no answer from the reader, the words already known decide
    expect(heroModeOf({ subject: 'either' })).toBe('product');
    expect(heroModeOf({ subject: 'person' })).toBe('presenter');
    expect(heroModeOf({ figure: 'one person' })).toBe('presenter');
    expect(heroModeOf({ figure: 'one person', holds: ['person', 'product'] })).toBe('both');
    // an answer that is not one of the four is no answer
    expect(heroModeOf({ hero: 'banner', figure: 'one person' })).toBe('presenter');
  });

  it('picks its stand-ins the way the set does, the same every time, and none for the place alone', () => {
    const scene = { id: 'us-1', verticals: ['Fragrance'] };
    expect(heroWithFor('product', scene, products, people)).toEqual({ product: 'vial' });
    expect(heroWithFor('presenter', scene, products, people)).toEqual({ presenter: 'amara' });
    expect(heroWithFor('both', scene, products, people)).toEqual({ product: 'vial', presenter: 'amara' });
    expect(heroWithFor('place', scene, products, people)).toBeNull();
    // nobody to stand in it is no hero, never half of one
    expect(heroWithFor('both', scene, products, [])).toBeNull();
  });

  it('dresses a stand-in out of the capture uniform, by name, and holds every pose to real physics', () => {
    for (const words of [
      heroPresenterInstruction('', true),
      heroBothInstruction('a glass perfume vial', null, [], '', true),
    ]) {
      expect(words).toContain(
        'a fitted off-white ribbed tank top and matching fitted off-white leggings, barefoot) is never their clothes',
      );
      expect(words).toContain('they are never barefoot');
      expect(words).toContain('Real physics holds for everyone and everything in the frame');
    }
  });

  it('with a person and a product, says both, and keeps the product at its own size', () => {
    const words = heroBothInstruction('a glass perfume vial', null, [], 'the buzz cut must survive', true);
    expect(words).toContain(
      'Put the person in the references into it as the hero of this place, with a glass perfume vial',
    );
    expect(words).toContain('at its true real-world size');
    expect(words).toContain('Any person in it is a stand-in');
    expect(words).toContain('only marks where the product goes');
    expect(words).toContain('Add no other person, no other product and no text');
  });
});

describe('the hero comes first', { timeout: 30_000 }, () => {
  it('a Draw makes the place and then the place in use, and the hero is never the picture a shot is given', async () => {
    const { calls, studio } = await setup();
    const job = await studio({ instruction: 'A minimal brutalist hall of raw concrete with a low plinth' });
    expect(job.status).toBe('done');
    // the place, drawn from the words; then the hero, at the vial's own scale
    // (the plate is drawn from the place's picture, then the vial placed on it)
    expect(calls.generate).toHaveLength(2);
    expect(calls.generate[1].referenceImages).toEqual([core.images.pathFor(job.hash)]);
    expect(calls.edit).toHaveLength(1);
    expect(job.hero).toMatch(/^[a-f0-9]{32}$/);
    expect(job.hero).not.toBe(job.hash);
    expect(job.heroWith).toEqual({ product: 'vial' });
  });

  it('Use this scene saves the place, the hero drawn from it and the hero as the cover, and spends nothing', async () => {
    const { app, brandId, calls, studio, sceneOf, status } = await setup();
    const job = await studio({ instruction: 'A minimal brutalist hall of raw concrete with a low plinth' });
    const spent = calls.generate.length + calls.edit.length;
    const saved = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/scenes`,
      payload: {
        name: 'Concrete Hall',
        prompt: job.reading.prompt,
        lighting: job.reading.lighting,
        previewHash: job.hash,
        anchor: job.anchor,
        heroHash: job.hero,
        heroWith: job.heroWith,
        cover: 'hero',
      },
    });
    expect(saved.statusCode).toBe(200);
    const id = saved.json().scene.id;
    const scene = sceneOf(id);
    // the place is still the picture a shot is given
    expect(scene.preview).toBe(`asset:${job.hash}`);
    expect(scene.examples).toEqual([
      { role: 'hero', file: `asset:${job.hero}`, from: `asset:${job.hash}`, product: 'vial' },
    ]);
    expect(scene.cover).toBe('hero');
    expect(calls.generate.length + calls.edit.length).toBe(spent);
    // nothing runs, and the rest of the set is the close-up, asked for
    const s = await status(id);
    expect(s.job).toBeNull();
    expect(s.first).toEqual(['close']);
  });

  it('a world shown as the place alone draws no hero', async () => {
    const { calls, studio } = await setup();
    const job = await studio({ instruction: 'An empty salt flat to the horizon, nobody in it' });
    expect(job.status).toBe('done');
    expect(calls.generate).toHaveLength(1);
    expect(calls.edit).toHaveLength(0);
    expect(job.hero).toBeNull();
    expect(job.heroWith).toBeNull();
  });

  it('a person with a product: their views and the product ride with the place, in one edit', async () => {
    const { calls, studio } = await setup(0, true, { presenter: true });
    const job = await studio({ instruction: 'A sunlit kitchen, a portrait of someone holding the product' });
    expect(job.heroWith).toEqual({ product: 'vial', presenter: 'amara' });
    const hero = calls.edit.at(-1);
    expect(hero.sourceImage).toBe(core.images.pathFor(job.hash));
    expect(hero.referenceRoles).toEqual(['character', 'character', 'product']);
    expect(hero.instruction).toContain('as the hero of this place, with a glass perfume vial');
  });

  it('a person with a product: the close-up is the product’s, with them in it only where it is worn', async () => {
    const { app, brandId, calls, studio, sceneOf, drawn } = await setup(0, true, { presenter: true });
    const job = await studio({ instruction: 'A sunlit kitchen, a portrait of someone holding the product' });
    const id = (
      await app.inject({
        method: 'POST',
        url: `/api/brands/${brandId}/scenes`,
        payload: {
          name: 'Kitchen',
          prompt: job.reading.prompt,
          lighting: job.reading.lighting,
          previewHash: job.hash,
          anchor: job.anchor,
          heroHash: job.hero,
          heroWith: job.heroWith,
          cover: 'hero',
        },
      })
    ).json().scene.id;
    expect((await drawn(id)).done).toEqual(['close']);
    const close = calls.edit.at(-1);
    expect(close.sourceImage).toBe(core.images.pathFor(job.hero));
    expect(close.instruction).toContain('move the camera in close on a glass perfume vial');
    expect(close.instruction).toContain('If a glass perfume vial is something a person wears');
    expect(close.instruction).not.toContain('head and shoulders');
    expect(close.referenceRoles).toEqual(['product', 'character']);
    expect(sceneOf(id).examples.find((e: any) => e.role === 'close')).toMatchObject({
      product: 'vial',
      presenter: 'amara',
      setup: 'close',
    });
  });

  it('Change something edits the place and the hero by the same sentence, keeping who stands in it', async () => {
    const { calls, studio } = await setup();
    const made = await studio({ instruction: 'A minimal brutalist hall of raw concrete with a low plinth' });
    const before = calls.edit.length;
    const changed = await studio({
      kind: 'change',
      reading: made.reading,
      from: made.hash,
      fromAnchor: made.anchor,
      fromHero: made.hero,
      heroWith: made.heroWith,
      ask: 'make the light warmer',
    });
    expect(changed.status).toBe('done');
    expect(calls.edit.length - before).toBe(2);
    const [place, hero] = calls.edit.slice(before);
    expect(place.sourceImage).toBe(core.images.pathFor(made.hash));
    expect(hero.sourceImage).toBe(core.images.pathFor(made.hero));
    expect(hero.instruction).toContain('changed only in this: make the light warmer');
    expect(changed.heroWith).toEqual(made.heroWith);
  });

  it('a hero that fails leaves the place standing and says so', async () => {
    const { gate, studio } = await setup();
    // the second generate is the hero's plate
    gate.fail = (kind, n) => kind === 'generate' && n === 2;
    const job = await studio({ instruction: 'A minimal brutalist hall of raw concrete with a low plinth' });
    expect(job.status).toBe('done');
    expect(job.hash).toMatch(/^[a-f0-9]{32}$/);
    expect(job.hero).toBeNull();
    expect(job.warnings.join(' ')).toContain('showing it in use did not work');
  });

  it('Use while it draws puts the hero on the scene with its place, as the cover', async () => {
    const { app, brandId, calls, gate, studioUrl, sceneOf } = await setup();
    // hold the hero's placement edit open
    gate.hold = (n) => n === 1;
    const started = await app.inject({
      method: 'POST',
      url: studioUrl,
      payload: { kind: 'make', conversation: 'convo-2', instruction: 'A minimal hall of raw concrete, a low plinth' },
    });
    const { jobId } = started.json();
    // the place has landed and the hero's placement is being drawn
    for (const until = Date.now() + 20_000; Date.now() < until && calls.edit.length < 1; )
      await new Promise((r) => setTimeout(r, 10));
    const saved = await app.inject({
      method: 'POST',
      url: `/api/brands/${brandId}/scenes`,
      payload: { name: 'Hall', prompt: 'A minimal hall of raw concrete, a low plinth.' },
    });
    const id = saved.json().scene.id;
    const attach = await app.inject({ method: 'POST', url: `${studioUrl}/${jobId}/attach`, payload: { sceneId: id } });
    expect(attach.json().state).toBe('pending');
    gate.open();
    for (const until = Date.now() + 20_000; Date.now() < until && !sceneOf(id).preview; )
      await new Promise((r) => setTimeout(r, 10));
    const job = (await app.inject({ method: 'GET', url: `${studioUrl}/${jobId}` })).json();
    const scene = sceneOf(id);
    expect(scene.preview).toBe(`asset:${job.hash}`);
    expect(scene.examples.map((e: any) => [e.role, e.file, e.from])).toEqual([
      ['hero', `asset:${job.hero}`, `asset:${job.hash}`],
    ]);
    expect(scene.cover).toBe('hero');
  });
});

/* ------------------------------------------------------------ retries, stops and failures */

const RATE = 'OpenRouter request failed: HTTP 429: {"error":{"message":"Rate limit exceeded","code":429}}';
const CODEX_401 = 'codex exited with code 1: ERROR: unexpected status 401 Unauthorized';

describe("a scene's examples through retries, stops and failures", { timeout: 30_000 }, () => {
  it('never leaves a hero on a scene after its file was let go, and the next example still draws (SS-H6)', async () => {
    const { app, brandId, gate, sceneOf, settled, makeScene, ask } = await setup();
    gate.copySource = true;
    // Use of studio version A: the place and the hero drawn with it
    const heroA = core.images.save(await png(111));
    const id = await makeScene({ heroHash: heroA, heroWith: { product: 'vial' } });
    expect(sceneOf(id).examples.map((e: any) => e.file)).toEqual([`asset:${heroA}`]);

    // Try again on the hero: the new hero lands and the old one is let go
    await ask(id, { roles: ['hero'] });
    expect((await settled(id)).done).toEqual(['hero']);
    expect(core.images.has(heroA)).toBe(false);

    // the conversation still offers version A, and it is Used again
    await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brandId}/scenes/${id}`,
      payload: { previewHash: hashOf(sceneOf(id).preview), anchor: true, heroHash: heroA },
    });
    const hero = sceneOf(id).examples.find((e: any) => e.role === 'hero');
    expect(core.images.has(hashOf(hero.file))).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/api/images/${hashOf(hero.file)}` })).statusCode).toBe(200);

    // and the next example drawn from the hero does not fail on a missing file
    await ask(id, { roles: ['close'] });
    const job = await settled(id);
    expect(job.failed).toEqual([]);
    expect(job.done).toContain('close');
  });

  it('draws a Try again pressed right after Stop, never absorbed by the run that is stopping (SS-H4)', async () => {
    const { app, gate, sceneOf, settled, drawing, makeScene, ask, url } = await setup();
    // the second edit is the close-up; hold it, and let it take a moment to die
    gate.hold = (n) => n === 2;
    gate.slowToDie = true;
    const id = await makeScene();
    await ask(id, { first: true });
    await drawing(id, 'close');
    const stopped = (await app.inject({ method: 'GET', url: url(id) })).json().job;
    expect((await app.inject({ method: 'POST', url: url(id, '/stop') })).json()).toEqual({ ok: true });

    const retry = await ask(id, { roles: ['close'] });
    // the held edit answers now whatever the outcome, so the server can drain
    gate.hold = null;
    gate.open();
    // refused while it stops, or a run of its own: never the run that is ending
    if (retry.statusCode === 200) expect(retry.json().job.id).not.toBe(stopped.id);
    else expect(retry.statusCode).toBe(409);
    await settled(id);
    if (retry.statusCode === 200) {
      await settled(id);
      expect(sceneOf(id).examples.map((e: any) => e.role)).toContain('close');
    }
  });

  it('draws a role asked for three times once (SS-H5)', async () => {
    const { calls, settled, makeScene, ask } = await setup();
    const id = await makeScene();
    await ask(id, { first: true });
    await settled(id);
    const before = calls.edit.length;
    expect((await ask(id, { roles: ['close', 'close', 'close'] })).statusCode).toBe(200);
    const job = await settled(id);
    expect(calls.edit.length - before).toBe(1);
    expect(job.done).toEqual(['close']);
  });

  it('draws hands once when Add more is pressed again while hands draws (SS-H5)', async () => {
    const { gate, settled, drawing, makeScene, ask } = await setup();
    const id = await makeScene();
    await ask(id, { first: true });
    await settled(id);
    // the hero and the close-up are one edit each; hands is the third
    gate.hold = (n) => n === 3;
    await ask(id, { more: true });
    await drawing(id, 'hands');
    await ask(id, { more: true });
    gate.hold = null;
    gate.open();
    const job = await settled(id);
    expect(job.done.filter((r: string) => r === 'hands')).toHaveLength(1);
  });

  it('draws the hero once when "Draw it in use" is pressed again while the hero draws (OP-X8)', async () => {
    const { gate, settled, drawing, makeScene, press } = await setup();
    const id = await makeScene();
    gate.hold = (n) => n === 1;
    expect((await press(id)).statusCode).toBe(200);
    await drawing(id, 'hero');
    const again = await press(id);
    expect(again.statusCode).toBe(200);
    const queued = again.json().job.roles as string[];
    gate.hold = null;
    gate.open();
    const job = await settled(id);
    expect(queued.filter((r) => r === 'hero')).toHaveLength(1);
    expect(job.done.filter((r: string) => r === 'hero')).toHaveLength(1);
  });

  it('spends only the picture a Try again on one example asks for, on a place that moved on (SC-H20)', async () => {
    const { app, brandId, calls, settled, makeScene, press, ask } = await setup();
    const id = await makeScene();
    await press(id);
    expect((await settled(id)).done).toEqual(['hero', 'close']);
    // the place is drawn again: both examples now show it as it was
    const next = core.images.save(await png(90));
    await app.inject({ method: 'PATCH', url: `/api/brands/${brandId}/scenes/${id}`, payload: { previewHash: next } });
    const before = calls.generate.length + calls.edit.length;

    const res = await ask(id, { roles: ['close'] });
    // refused, and said why: nothing spent behind the press
    if (res.statusCode >= 400) return;
    const job = await settled(id);
    expect(job.roles).toEqual(['close']);
    expect(calls.generate.length + calls.edit.length - before).toBe(1);
  });

  it('a set whose close-up failed while the hero landed is not reported as a clean finish (FAIL-X3, OP-X4)', async () => {
    const s = await setup(0, true, { lamp: true });
    s.gate.failRole = (role) => (role === 'close' ? RATE : null);
    const id = await s.makeScene();
    expect((await s.ask(id, { first: true })).statusCode).toBe(200);
    const job = await s.settled(id);

    // the work itself is right: the hero stands, the close-up says why it is missing
    expect(s.gate.roles).toEqual(['hero', 'close']);
    expect(s.sceneOf(id).examples.map((e: any) => e.role)).toEqual(['hero']);
    expect(job.failed).toEqual([{ role: 'close', error: RATE }]);

    // what Activity says, and so what the toast a person who left is given says
    const row = (await s.activity()).find((w) => w.kind === 'examples');
    expect(row.error).not.toBeNull();
  });

  it('asks a signed-out engine once for a set, not once per example (FAIL-X4)', async () => {
    const s = await setup(0, true, { lamp: true });
    const id = await s.makeScene();
    await s.ask(id, { first: true });
    await s.settled(id);
    const before = s.gate.roles.length;
    s.gate.failRole = () => CODEX_401;
    await s.ask(id, { more: true });
    await s.settled(id);
    expect(s.gate.roles.length - before).toBe(1);
  });

  it('keeps an example off the scene when Stop reaches the server as it is being finished (FAIL-X5)', async () => {
    const s = await setup(0, true, { lamp: true });
    // a picture the size the engines hand back, so finishing it takes as long as it really does
    s.gate.size = [1024, 1280];
    const id = await s.makeScene();
    let stop: Promise<{ json: () => { ok: boolean } }> | null = null;
    s.gate.onReturn = (role) => {
      // Stop is pressed as the provider answers: the request is on its way while the picture is finished
      if (role === 'hero' && !stop) stop = s.app.inject({ method: 'POST', url: s.url(id, '/stop') });
    };
    await s.ask(id, { roles: ['hero'] });
    const job = await s.settled(id);
    const answered = await (stop as unknown as Promise<{ json: () => { ok: boolean } }>);
    expect(answered.json().ok).toBe(true);
    expect(job.status).toBe('cancelled');
    expect((s.sceneOf(id).examples ?? []).map((e: any) => e.role)).toEqual([]);
  });
});
