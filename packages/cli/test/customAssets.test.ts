import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';
import { createCore, type Core, type EngineAdapter, type GenerateRequest } from '@scenri/core';
import { buildServer } from '../src/server.js';
import {
  CONSENSUS_NOTE,
  FIGURE_VIEW_CLAUSE,
  lintSceneProse,
  resetAssetBuilds,
  runningAssetBuildCount,
  scenePreviewPrompt,
  sceneViewPrompt,
  trimEdgeBars,
  WORLD_CLAUSE,
  type CustomScene,
} from '../src/customAssets.js';
import type { FastifyInstance } from 'fastify';

const CATALOG_SCENE = {
  id: 'studio-shelf',
  name: 'Studio Shelf',
  promptName: 'Studio Shelf',
  lighting: 'Even softbox light',
  description: 'A plain studio shelf.',
  subject: 'product',
  collections: ['Studio'],
  verticals: ['Beauty'],
  prompt: 'A plain plaster shelf under even softbox light.',
  width: 1024,
  height: 1280,
};

const SCENE_BODY = {
  name: 'Wet Basalt Shore',
  promptName: 'Wet Basalt Shore',
  lighting: 'Low directional sunset',
  description: 'A dark volcanic shoreline at last light.',
  subject: 'product',
  prompt: 'A wet dark basalt shelf at low sunset light, cool ocean haze behind.',
  collections: ['Editorial'],
  verticals: ['Beauty'],
  keywords: ['volcanic', 'shore'],
};

describe('custom presenters and scenes', () => {
  let templatesDir: string;
  let home: string;
  let core: Core;
  let app: FastifyInstance;
  let generated: GenerateRequest[];
  let analyzed: any[];
  /** Swap in to simulate an install with no codex and no engine that draws. */
  let engineAvailable: boolean;
  /** One-shot bytes the spy engine answers with, then clears. */
  let nextGenerated: Buffer | null = null;

  const png = (tint: string) =>
    sharp({ create: { width: 64, height: 80, channels: 3, background: tint } })
      .png()
      .toBuffer();

  const engine = (): EngineAdapter => ({
    capabilities: () => ({
      id: 'spy',
      displayName: 'Spy',
      localOnly: false,
      supportsEdit: true,
      supportsMask: false,
      maxReferenceImages: 6,
    }),
    isAvailable: async () => (engineAvailable ? { ok: true } : { ok: false, reason: 'not here' }),
    costEstimate: async () => 0,
    generate: async (req) => {
      generated.push(req);
      // A one-shot override so a single test can make the engine answer
      // specific bytes (the redraw-trim case needs a barred frame back).
      if (nextGenerated) {
        const buf = nextGenerated;
        nextGenerated = null;
        return { images: [core.images.save(buf)], costUsd: 0 };
      }
      // A distinct image per call: the export rewriter writes identical bytes
      // once and shares the path, which would hide a naming bug behind dedupe.
      const shade = (0x20 + generated.length * 0x11).toString(16).padStart(2, '0');
      return { images: [core.images.save(await png(`#${shade}3040`))], costUsd: 0 };
    },
    edit: async () => ({ images: [], costUsd: 0 }),
  });

  /** Stands in for codex: records what it was asked, answers a valid record. */
  const analyzer = (available = true) => ({
    isAvailable: async () => (available ? { ok: true } : { ok: false, reason: 'no codex' }),
    analyze: async (req: any) => {
      analyzed.push(req);
      return req.kind === 'presenter'
        ? {
            promptName: 'a woman in her early thirties with dark waves',
            presentation: 'woman' as const,
            descriptor: 'Warm editorial · dark waves · composed',
            ageRange: 'early 30s',
            hair: 'dark shoulder-length waves',
            identityNotes: 'the wide-set eyes must survive every generation',
            negativeConstraints: ['no straightened hair'],
            suitableCategories: ['Beauty'],
            coverage: ['A three-quarter photo would pin the cheekbones down.'],
          }
        : {
            name: 'Wet Basalt Shore',
            promptName: 'Wet Basalt Shore',
            lighting: 'Low directional sunset',
            description: 'A dark volcanic shoreline at last light.',
            subject: 'product' as const,
            collections: ['Editorial'],
            verticals: ['Beauty'],
            keywords: ['volcanic', 'shore'],
            // The set read back once: a revised prompt, and a figure it should
            // not be allowed to take away from the locked record.
            prompt:
              req.correction === CONSENSUS_NOTE
                ? 'A wet dark basalt shelf at low sunset light, read across the whole set.'
                : 'A wet dark basalt shelf at low sunset light.',
            camera: 'low three-quarter',
            // A direction that says the place is empty gets no figure.
            figure:
              req.correction === CONSENSUS_NOTE || /empty/i.test(String(req.instruction ?? ''))
                ? ''
                : 'someone stands at the tide line, mid-ground, at human scale',
            figureTreatment: 'the face wrapped in translucent fabric',
            coverage: ['A wider frame would pin down how the shelf sits in the bay.'],
          };
    },
  });

  const start = (opts: { analyzer?: any } = {}) => {
    const e = engine();
    return buildServer({
      core,
      engines: { all: () => [e], get: (id) => (id === 'spy' ? e : null) },
      templatesDir,
      analyzer: opts.analyzer ?? analyzer(),
    });
  };

  beforeEach(async () => {
    resetAssetBuilds();
    generated = [];
    analyzed = [];
    engineAvailable = true;
    nextGenerated = null;
    templatesDir = mkdtempSync(join(tmpdir(), 'sc-custom-templates-'));
    mkdirSync(join(templatesDir, 'presenters'), { recursive: true });
    writeFileSync(join(templatesDir, `${CATALOG_SCENE.id}.json`), JSON.stringify(CATALOG_SCENE));
    home = mkdtempSync(join(tmpdir(), 'sc-custom-home-'));
    core = createCore(home);
    app = start();
  });

  afterEach(async () => {
    resetAssetBuilds();
    await app.drain();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(templatesDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const newBrand = async (json?: any) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: json ?? { specVersion: '0.1', meta: { name: 'Acme' } } },
      })
    ).json();

  const savePhoto = async (tint = '#884422') => core.images.save(await png(tint));

  const brandJson = (id: string) => core.store.getBrand(id)?.json as any;

  /** Run the pipeline to a finish and hand back the job. */
  const runBuild = async (brandId: string, payload: any) => {
    const started = await app.inject({ method: 'POST', url: `/api/brands/${brandId}/asset-builds`, payload });
    if (started.statusCode !== 200) return { started, job: null as any };
    const { jobId } = started.json();
    for (let i = 0; i < 200; i++) {
      const job = (await app.inject({ method: 'GET', url: `/api/brands/${brandId}/asset-builds/${jobId}` })).json();
      if (job.finished) return { started, job };
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('build never finished');
  };

  /** Wait out a build started by something other than runBuild. */
  const settle = async (brandId: string, jobId: string) => {
    for (let i = 0; i < 200; i++) {
      const job = (await app.inject({ method: 'GET', url: `/api/brands/${brandId}/asset-builds/${jobId}` })).json();
      if (job.finished) return job;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('build never finished');
  };

  const getJob = async (brandId: string, jobId: string) =>
    (await app.inject({ method: 'GET', url: `/api/brands/${brandId}/asset-builds/${jobId}` })).json();

  /** Wait for a staged build to reach one of these stages, or to end. */
  const waitStage = async (brandId: string, jobId: string, ...stages: string[]) => {
    for (let i = 0; i < 400; i++) {
      const job = await getJob(brandId, jobId);
      if (job.finished || stages.includes(job.stage)) return job;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`build never reached ${stages.join('|')}`);
  };

  /** One decision on a staged build. */
  const act = (brandId: string, jobId: string, path: string, payload?: any, method: 'POST' | 'DELETE' = 'POST') =>
    app.inject({ method, url: `/api/brands/${brandId}/asset-builds/${jobId}/${path}`, payload });

  const startScene = async (brandId: string, payload: any) => {
    const started = await app.inject({ method: 'POST', url: `/api/brands/${brandId}/asset-builds`, payload });
    if (started.statusCode !== 200) throw new Error(`start ${started.statusCode}: ${started.body}`);
    return String(started.json().jobId);
  };

  /** Walk a staged scene build to the end: say yes to the seed, save at review. */
  const buildScene = async (brandId: string, payload: any, finish: any = {}) => {
    const started = await app.inject({ method: 'POST', url: `/api/brands/${brandId}/asset-builds`, payload });
    if (started.statusCode !== 200) return { started, job: null as any };
    const { jobId } = started.json();
    let job = await waitStage(brandId, jobId, 'awaiting', 'reviewing');
    if (job.stage === 'awaiting') {
      await act(brandId, jobId, 'approve');
      job = await waitStage(brandId, jobId, 'reviewing');
    }
    if (job.finished) return { started, job };
    const name = finish.name ?? payload.name ?? job.suggestedName ?? 'New scene';
    const r = await act(brandId, jobId, 'finish', { ...finish, name });
    if (r.statusCode !== 200) throw new Error(`finish ${r.statusCode}: ${r.body}`);
    job = await settle(brandId, jobId);
    return { started, job };
  };

  /* ------------------------------------------------------------ presenters */

  it('builds a presenter: photos analysed, four studio views drawn, photos kept', async () => {
    const brand = await newBrand();
    const photos = [await savePhoto('#884422'), await savePhoto('#224488')];
    const { job } = await runBuild(brand.id, { kind: 'presenter', name: 'Mara', imageHashes: photos });

    expect(job.stage).toBe('done');
    expect(job.coverage[0]).toContain('three-quarter');

    const person = brandJson(brand.id).characters[0];
    expect(person.id).toMatch(/^up-[a-f0-9]{8}$/);
    expect(person.origin).toBe('custom');
    expect(person.name).toBe('Mara');
    expect(person.promptName).toBe('a woman in her early thirties with dark waves');
    expect(person.identityNotes).toContain('wide-set eyes');
    // Filed under a tab that already exists, so they are reachable from it.
    expect(person.suitableCategories).toEqual(['Beauty']);
    // The five normalized views are what a brief attaches, and the portrait
    // leads: shots[0] is the essential character reference, and every other
    // view is full-length, which carries build and proportion and about 105px
    // of face. Four outputs of one brief came back with four different jaws.
    expect(person.shots).toHaveLength(5);
    expect(person.shots.every((s: any) => s.locked)).toBe(true);
    // The photographs are the evidence and are never replaced by a drawing.
    expect(person.sourceRefs.map((r: any) => r.file)).toEqual(photos.map((h) => `asset:${h}`));
    // Both thumbnails are crops of the full-length FRONT view, never pictures
    // of their own, so neither can show a different person than the references
    // do. Not shots[0] any more: that seat belongs to the portrait, and the
    // crops are geometric off a standing figure.
    expect(person.preview).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(person.preview).not.toBe(person.shots[1].file);
    expect(person.avatar).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(person.avatar).not.toBe(person.preview);

    // The portrait and the front view are both drawn from the photographs -
    // the only real face evidence in the system - and every other view chains
    // off the front.
    expect(generated).toHaveLength(5);
    expect(generated[0].prompt).toContain('head-and-shoulders portrait framing');
    expect(generated[0].prompt).toContain('down to the collarbone');
    expect(generated[1].referenceImages).toHaveLength(2);
    expect(generated[1].referenceRoles).toEqual(['character', 'character']);
    expect(generated[1].prompt).toContain('facing the camera straight-on');
    expect(generated[1].prompt).toContain('a woman in her early thirties with dark waves');
    // The capture uniform is a contract: the compiler's wardrobe-release
    // directive names it as neutral capture clothing, so the front frame must
    // keep drawing exactly this outfit — a drift here would quietly desync
    // what the release clause is releasing.
    expect(generated[1].prompt).toContain('off-white ribbed tank');
    // Both source-drawn frames read the photographs; only the chained ones
    // stand on a single anchor.
    expect(generated[0].referenceImages).toHaveLength(2);
    for (const later of generated.slice(2)) expect(later.referenceImages).toHaveLength(1);
    expect(generated[4].prompt).toContain('back view');
    expect(analyzed[0].kind).toBe('presenter');
    expect(analyzed[0].imagePaths).toHaveLength(2);
  });

  it('falls back to the photographs themselves when nothing can draw or read them', async () => {
    await app.close();
    engineAvailable = false;
    app = start({ analyzer: analyzer(false) });
    const brand = await newBrand();
    const photos = [await savePhoto()];
    const { job } = await runBuild(brand.id, { kind: 'presenter', name: 'Mara', imageHashes: photos });

    expect(job.stage).toBe('done');
    expect(job.warnings.join(' ')).toContain('photos are being used directly');
    const person = brandJson(brand.id).characters[0];
    expect(person.shots.map((s: any) => s.file)).toEqual([`asset:${photos[0]}`]);
    expect(person.promptName).toBeUndefined();
    expect(generated).toHaveLength(0);
    expect(analyzed).toHaveLength(0);
    // This path used to run the top-anchored studio-frame geometry over an
    // arbitrary photograph — a square of forehead as the avatar. It now
    // derives both thumbnails saliency-first, and they always exist.
    expect(person.preview).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(person.avatar).toMatch(/^asset:[a-f0-9]{32}$/);
  });

  it('a manual create and a shot replacement both derive fresh thumbnails', async () => {
    const brand = await newBrand();
    const first = await savePhoto('#101010');
    const made = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/presenters`,
      payload: { name: 'Noor', shotHashes: [first] },
    });
    expect(made.statusCode).toBe(200);
    const p0 = made.json().presenter;
    // Created without a build, the presenter still gets both derived images.
    expect(p0.preview).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(p0.avatar).toMatch(/^asset:[a-f0-9]{32}$/);

    // Replacing the shots recomputes the crops: the old avatar pointed at a
    // frame that just left the set.
    const replaced = await savePhoto('#f0e0d0');
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brand.id}/presenters/${p0.id}`,
      payload: { shotHashes: [replaced] },
    });
    expect(patched.statusCode).toBe(200);
    const p1 = patched.json().presenter;
    expect(p1.avatar).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(p1.avatar).not.toBe(p0.avatar);
    expect(p1.preview).not.toBe(p0.preview);

    // An explicit hash always wins over the derivation.
    const explicit = await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brand.id}/presenters/${p0.id}`,
      payload: { shotHashes: [first], avatarHash: first, previewHash: first },
    });
    expect(explicit.statusCode).toBe(200);
    expect(explicit.json().presenter.avatar).toBe(`asset:${first}`);
    expect(explicit.json().presenter.preview).toBe(`asset:${first}`);
  });

  it('files under the categories the person chose, over the ones read off the photos', async () => {
    const brand = await newBrand();
    await runBuild(brand.id, {
      kind: 'presenter',
      name: 'Mara',
      imageHashes: [await savePhoto()],
      facets: ['Apparel', 'Footwear'],
    });
    expect(brandJson(brand.id).characters[0].suitableCategories).toEqual(['Apparel', 'Footwear']);

    const scene = await buildScene(brand.id, {
      kind: 'scene',
      name: 'Shore',
      instruction: 'a beach',
      imageHashes: [],
      facets: ['Home'],
    });
    expect(scene.job.stage).toBe('done');
    expect(brandJson(brand.id).scenes[0].verticals).toEqual(['Home']);
  });

  it('refuses a presenter with no photo', async () => {
    const brand = await newBrand();
    const res = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/asset-builds`,
      payload: { kind: 'presenter', name: 'Mara', imageHashes: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/at least one photo/);
  });

  it('reaches a brief by promptName, attaching the identity views only', async () => {
    const brand = await newBrand();
    const photos = [await savePhoto()];
    await runBuild(brand.id, { kind: 'presenter', name: 'Mara', imageHashes: photos });
    const id = brandJson(brand.id).characters[0].id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: { brandId: brand.id, engineId: 'spy', brief: { tokens: [{ t: 'character', id }] } },
    });
    const compiled = res.json();
    expect(compiled.prompt).toContain('a woman in her early thirties with dark waves');
    expect(compiled.prompt).not.toContain('Mara');
    expect(compiled.prompt).toContain('the wide-set eyes must survive');
    expect(compiled.prompt).toContain('Avoid: no straightened hair');
    // three of the four studio views since the likeness bump (CHARACTER_REF_MAX)
    expect(compiled.attachments.filter((a: any) => a.role === 'character')).toHaveLength(3);
    expect(compiled.attachments[0].essential).toBe(true);
  });

  it('renames without changing what a generation says, and refuses to edit an older cast', async () => {
    const brand = await newBrand({
      specVersion: '0.1',
      meta: { name: 'Acme' },
      characters: [{ id: 'legacy', name: 'Old Cast' }],
    });
    const photos = [await savePhoto()];
    await runBuild(brand.id, { kind: 'presenter', name: 'Mara', imageHashes: photos });
    const id = brandJson(brand.id).characters.find((c: any) => c.origin === 'custom').id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brand.id}/presenters/${id}`,
      payload: { name: 'Mara Vance', descriptor: 'Quiet, editorial' },
    });
    expect(patched.statusCode).toBe(200);
    const person = brandJson(brand.id).characters.find((c: any) => c.id === id);
    expect(person.name).toBe('Mara Vance');
    expect(person.descriptor).toBe('Quiet, editorial');
    expect(person.promptName).toBe('a woman in her early thirties with dark waves'); // frozen
    expect(person.shots).toHaveLength(5); // untouched by a field edit

    const legacy = await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brand.id}/presenters/legacy`,
      payload: { name: 'Renamed' },
    });
    expect(legacy.statusCode).toBe(400);
    expect(legacy.json().error).toMatch(/not editable/);
  });

  it('reorders the views a brief attaches', async () => {
    const brand = await newBrand();
    await runBuild(brand.id, { kind: 'presenter', name: 'Mara', imageHashes: [await savePhoto()] });
    const person = brandJson(brand.id).characters[0];
    const reversed = [...person.shots].reverse().map((s: any) => s.file.slice(6));

    await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brand.id}/presenters/${person.id}`,
      payload: { shotHashes: reversed },
    });
    expect(brandJson(brand.id).characters[0].shots.map((s: any) => s.file.slice(6))).toEqual(reversed);
  });

  it('deleting one leaves the shots it made alone, and says so on the next run', async () => {
    const brand = await newBrand();
    await runBuild(brand.id, { kind: 'presenter', name: 'Mara', imageHashes: [await savePhoto()] });
    const id = brandJson(brand.id).characters[0].id;

    const del = await app.inject({ method: 'DELETE', url: `/api/brands/${brand.id}/presenters/${id}` });
    expect(del.statusCode).toBe(200);
    expect(brandJson(brand.id).characters).toHaveLength(0);

    const res = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: { brandId: brand.id, engineId: 'spy', brief: { tokens: [{ t: 'character', id }] } },
    });
    expect(res.json().warnings.join(' ')).toContain('no longer in your roster');
  });

  /* ---------------------------------------------------------------- scenes */

  it('builds a scene: references read into a record, one empty preview drawn', async () => {
    const brand = await newBrand();
    const refs = [await savePhoto('#334455')];
    const { job } = await buildScene(brand.id, {
      kind: 'scene',
      name: 'Wet Basalt Shore',
      instruction: 'keep the rocks, less orange',
      imageHashes: refs,
    });

    expect(job.stage).toBe('done');
    const scene = brandJson(brand.id).scenes[0];
    expect(scene.id).toMatch(/^us-[a-f0-9]{8}$/);
    expect(scene.subject).toBe('product');
    expect(scene.prompt).toContain('basalt');
    expect(scene.instruction).toBe('keep the rocks, less orange');
    // The upload is kept first, and is the evidence a shot never sees. What
    // the build drew of the same world follows it, marked as drawn.
    expect(scene.refs[0]).toEqual({ file: `asset:${refs[0]}` });
    expect(scene.refs.slice(1).every((r: any) => r.drawn === true)).toBe(true);
    // One upload plus the seed leaves two views to draw for a set of four.
    expect(scene.refs).toHaveLength(4);
    // The cover is the seed unless somebody chose otherwise, and it is one of the refs.
    expect(scene.preview).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(scene.refs.map((r: any) => r.file)).toContain(scene.preview);
    expect(scene.width).toBe(1024);
    expect(scene.height).toBe(1280);

    expect(analyzed[0].vocabulary.collections).toContain('Studio');
    // The seed shows the world, not a stand-in product it would have to invent.
    expect(generated).toHaveLength(3);
    expect(generated[0].prompt).toContain('A figure is in this photograph');
    // The seed draw has the whole reference budget to itself, and an output that
    // is a card rather than a customer's shot. So the world is read from pixels
    // here, and a shot still only ever gets the words.
    expect(generated[0].referenceImages).toHaveLength(refs.length);
    expect(generated[0].referenceRoles).toEqual(refs.map(() => 'scene'));
  });

  it('records the figure and its treatment, and never who it is', async () => {
    const brand = await newBrand();
    const { job } = await buildScene(brand.id, {
      kind: 'scene',
      name: 'Wet Basalt Shore',
      imageHashes: [await savePhoto('#223344')],
    });
    expect(job.stage).toBe('done');
    const scene = brandJson(brand.id).scenes[0];
    // The whole point: a person in a reference survives as a POSITION.
    expect(scene.figure).toBe('someone stands at the tide line, mid-ground, at human scale');
    expect(scene.figureTreatment).toBe('the face wrapped in translucent fabric');
    // Nothing about the record identifies anyone. Anatomy words are fair game -
    // a treatment has to say what surface it sits on - so this checks for the
    // language that would pin it to a particular person instead.
    expect(JSON.stringify(scene)).not.toMatch(/\bwoman\b|\bman\b|\bgirl\b|\bboy\b|\bhis\b|\bher\b|\byear[- ]old\b/i);
  });

  it('says what another reference would buy, through the channel presenters already use', async () => {
    const brand = await newBrand();
    const { job } = await buildScene(brand.id, {
      kind: 'scene',
      name: 'Wet Basalt Shore',
      imageHashes: [await savePhoto('#556677')],
    });
    expect(job.coverage).toEqual(['A wider frame would pin down how the shelf sits in the bay.']);
    // Advice is not a record: it is read once and never persisted.
    expect(brandJson(brand.id).scenes[0].coverage).toBeUndefined();
  });

  it('draws the staged position empty rather than pretending people do not occur', async () => {
    const brand = await newBrand();
    await buildScene(brand.id, {
      kind: 'scene',
      name: 'Wet Basalt Shore',
      imageHashes: [await savePhoto('#778899')],
    });
    const prompt = generated[0].prompt;
    expect(prompt).toContain('A figure is in this photograph: someone stands at the tide line');
    expect(prompt).toContain('the face wrapped in translucent fabric');
    // The source references are attached to this draw, so the card would happily
    // come back as the person in them without this.
    expect(prompt).toContain('do not reproduce any person from the attached reference images');
  });

  it('keeps the staged position when an edit touches only the prompt', async () => {
    const brand = await newBrand();
    await buildScene(brand.id, {
      kind: 'scene',
      name: 'Wet Basalt Shore',
      imageHashes: [await savePhoto('#99aabb')],
    });
    const id = brandJson(brand.id).scenes[0].id;
    // The scene page PATCHes prompt alone on every keystroke.
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brand.id}/scenes/${id}`,
      payload: { prompt: 'A wet dark basalt shelf, colder now.' },
    });
    expect(r.statusCode).toBe(200);
    expect(brandJson(brand.id).scenes[0].figure).toBe('someone stands at the tide line, mid-ground, at human scale');
  });

  it('reads an existing scene again in place, keeping its id', async () => {
    const brand = await newBrand();
    await buildScene(brand.id, {
      kind: 'scene',
      name: 'Wet Basalt Shore',
      imageHashes: [await savePhoto('#bbccdd')],
    });
    const before = brandJson(brand.id).scenes[0];
    analyzed = [];

    const r = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/scenes/${before.id}/reread`,
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    await settle(brand.id, JSON.parse(r.body).jobId);

    const rows = brandJson(brand.id).scenes;
    // Revised, never appended: every shot that already names this scene resolves.
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(before.id);
    // Its own stored references are the evidence, and it revises rather than restarts.
    expect(analyzed[0].imagePaths).toHaveLength(before.refs.length);
    expect(analyzed[0].priorDraft.id).toBe(before.id);
  });

  it('a re-read carries the direction the scene was built with', async () => {
    const brand = await newBrand();
    await buildScene(brand.id, {
      kind: 'scene',
      name: 'Wet Basalt Shore',
      instruction: 'keep the rocks, less orange',
      imageHashes: [await savePhoto('#4455aa')],
    });
    const before = brandJson(brand.id).scenes[0];
    analyzed = [];

    // A plain re-read used to drop the Direction on the floor: the analyzer's
    // deciding-word preamble never fired, and whatever the Direction excluded
    // came straight back into the record.
    const r = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/scenes/${before.id}/reread`,
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    await settle(brand.id, JSON.parse(r.body).jobId);

    expect(analyzed[0].instruction).toBe('keep the rocks, less orange');
    expect(analyzed[0].correction).toBe('keep the rocks, less orange');
    expect(brandJson(brand.id).scenes[0].instruction).toBe('keep the rocks, less orange');
  });

  it('a fresh correction outranks the stored direction', async () => {
    const brand = await newBrand();
    await buildScene(brand.id, {
      kind: 'scene',
      name: 'Wet Basalt Shore',
      instruction: 'keep the rocks, less orange',
      imageHashes: [await savePhoto('#5566bb')],
    });
    const before = brandJson(brand.id).scenes[0];
    analyzed = [];

    const r = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/scenes/${before.id}/reread`,
      payload: { correction: 'colder, no people' },
    });
    expect(r.statusCode).toBe(200);
    await settle(brand.id, JSON.parse(r.body).jobId);

    expect(analyzed[0].instruction).toBe('colder, no people');
    expect(brandJson(brand.id).scenes[0].instruction).toBe('colder, no people');
  });

  it('a note reads the same references with the direction kept; frames pick a subset in order; draw:false keeps the card', async () => {
    const brand = await newBrand();
    const { job } = await buildScene(brand.id, {
      kind: 'scene',
      instruction: 'keep the rocks, less orange',
      imageHashes: [],
      consensus: false,
    });
    const before = brandJson(brand.id).scenes[0];
    const refs = before.refs.map((r: any) => r.file.slice(6));
    analyzed = [];
    generated = [];
    const r = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/scenes/${before.id}/reread`,
      payload: { note: 'read the set as one', frames: [refs[2], refs[0]], draw: false },
    });
    expect(r.statusCode).toBe(200);
    await settle(brand.id, JSON.parse(r.body).jobId);
    // The Direction stays the Direction; the note is the correction.
    expect(analyzed[0].instruction).toBe('keep the rocks, less orange');
    expect(analyzed[0].correction).toBe('read the set as one');
    // Only the frames asked for, in the order asked.
    expect(analyzed[0].imagePaths).toEqual([core.images.pathFor(refs[2]), core.images.pathFor(refs[0])]);
    // No draw, and the card it had.
    expect(generated).toHaveLength(0);
    const after = brandJson(brand.id).scenes[0];
    expect(after.preview).toBe(before.preview);
    expect(after.refs).toEqual(before.refs);
    expect(after.instruction).toBe('keep the rocks, less orange');
  });

  it('refuses a second read while the first is still running', async () => {
    const brand = await newBrand();
    await buildScene(brand.id, {
      kind: 'scene',
      name: 'Wet Basalt Shore',
      imageHashes: [await savePhoto('#ddeeff')],
    });
    const id = brandJson(brand.id).scenes[0].id;
    const url = `/api/brands/${brand.id}/scenes/${id}/reread`;

    // The route hands back a job id the moment the work starts, never when it
    // ends. Anything that treats that as "done" - a button re-enabling on the
    // response - would spend a second analyzer call racing the first to write
    // the same record, and the later write would silently win.
    const first = await app.inject({ method: 'POST', url, payload: {} });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url, payload: {} });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error).toMatch(/already being read again/);

    await settle(brand.id, JSON.parse(first.body).jobId);
    // Once it is over, asking again is allowed.
    expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(200);
  });

  it('refuses to read again a scene that was written from words', async () => {
    const brand = await newBrand();
    // A scene written straight into the brand carries no evidence at all. (A
    // scene built from words alone now draws its own frames, which are.)
    const id = (await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scenes`, payload: SCENE_BODY })).json()
      .scene.id;
    const r = await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scenes/${id}/reread`, payload: {} });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/nothing to read again/);
  });

  it('builds a scene from words alone', async () => {
    const brand = await newBrand();
    const { job } = await buildScene(brand.id, {
      kind: 'scene',
      name: 'Shore',
      instruction: 'a volcanic beach at dusk',
      imageHashes: [],
    });
    expect(job.stage).toBe('done');
    expect(analyzed[0].imagePaths).toEqual([]);
    expect(brandJson(brand.id).scenes).toHaveLength(1);
  });

  it('refuses a scene with nothing to go on', async () => {
    const brand = await newBrand();
    const res = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/asset-builds`,
      payload: { kind: 'scene', name: 'Shore', imageHashes: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/reference image, or describe the place/);
  });

  it('compiles a brand scene exactly as a catalog one, and wins an id collision', async () => {
    const brand = await newBrand();
    const created = await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scenes`, payload: SCENE_BODY });
    const scene = created.json().scene;

    const mine = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: { brandId: brand.id, engineId: 'spy', brief: { tokens: [{ t: 'template', id: scene.id }] } },
    });
    expect(mine.json().prompt).toContain('wet dark basalt shelf');
    expect(mine.json().width).toBe(1024);
    // A scene contributes text and never an image, whoever it belongs to.
    expect(mine.json().referenceCount).toBe(0);

    // Same id as the catalog's: what the brand built for itself wins.
    await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/scenes`,
      payload: { ...SCENE_BODY, name: 'Mine' },
    });
    const shadow = brandJson(brand.id).scenes[1];
    core.store.updateBrand(brand.id, {
      ...brandJson(brand.id),
      scenes: [brandJson(brand.id).scenes[0], { ...shadow, id: CATALOG_SCENE.id }],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: { brandId: brand.id, engineId: 'spy', brief: { tokens: [{ t: 'template', id: CATALOG_SCENE.id }] } },
    });
    expect(res.json().prompt).toContain('basalt');
    expect(res.json().prompt).not.toContain('plaster shelf');
  });

  it('refuses a scene that has no prompt, or one that leaves a placeholder', async () => {
    const brand = await newBrand();
    const noPrompt = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/scenes`,
      payload: { ...SCENE_BODY, prompt: '' },
    });
    expect(noPrompt.statusCode).toBe(400);
    const placeholder = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/scenes`,
      payload: { ...SCENE_BODY, prompt: 'A shelf holding {product_name}.' },
    });
    expect(placeholder.statusCode).toBe(400);
    expect(placeholder.json().error).toMatch(/\{placeholder\}/);
  });

  it('warns when a scene names something a brief is supposed to bring', async () => {
    const brand = await newBrand({
      specVersion: '0.1',
      meta: { name: 'Aurelia' },
      products: [{ id: 'serum', name: 'Amber Serum' }],
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/scenes`,
      payload: { ...SCENE_BODY, prompt: 'A wet basalt shelf holding the Amber Serum at low sunset light.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings.join(' ')).toContain('Amber Serum');

    // Plain prose about a place says nothing about anyone's product.
    const clean = lintSceneProse(brandJson(brand.id), {
      prompt: 'A wet basalt shelf.',
      description: '',
    } as CustomScene);
    expect(clean).toEqual([]);
  });

  it('edits a scene, redraws its preview on request, and forgets it on delete', async () => {
    const brand = await newBrand();
    const scene = (
      await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scenes`, payload: SCENE_BODY })
    ).json().scene;

    await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brand.id}/scenes/${scene.id}`,
      payload: { prompt: 'A wet basalt shelf under flat daylight.', lighting: 'Overcast daylight' },
    });
    const edited = brandJson(brand.id).scenes[0];
    expect(edited.lighting).toBe('Overcast daylight');
    expect(edited.name).toBe('Wet Basalt Shore'); // a patch keeps what it does not carry

    const preview = await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scenes/${scene.id}/preview` });
    expect(preview.statusCode).toBe(200);
    expect(brandJson(brand.id).scenes[0].preview).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(generated[0].prompt).toContain('flat daylight'); // the edit, not the original

    await app.inject({ method: 'DELETE', url: `/api/brands/${brand.id}/scenes/${scene.id}` });
    const res = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: { brandId: brand.id, engineId: 'spy', brief: { tokens: [{ t: 'template', id: scene.id }] } },
    });
    expect(res.json().warnings.join(' ')).toContain('no longer installed');
  });

  // The plate is a conditioning image now: a redrawn card with baked-in bars
  // would be faithfully reproduced into customer shots, so the redraw route
  // trims exactly the way the build path always has.
  it('a redrawn preview goes through the edge-bar trim before it is stored', async () => {
    const brand = await newBrand();
    const scene = (
      await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scenes`, payload: SCENE_BODY })
    ).json().scene;

    const W = 200;
    const H = 250;
    const raw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const bar = x < 20 || x >= W - 20;
        const v = bar ? 250 : 120 + Math.round(40 * Math.sin((x / W) * Math.PI)) + (y % 7);
        raw.fill(v, (y * W + x) * 3, (y * W + x) * 3 + 3);
      }
    }
    const barredPng = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
      .png()
      .toBuffer();
    const barredHash = core.images.save(barredPng);

    nextGenerated = barredPng;
    const res = await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scenes/${scene.id}/preview` });
    expect(res.statusCode).toBe(200);
    const stored = String(brandJson(brand.id).scenes[0].preview).slice(6);
    expect(stored).not.toBe(barredHash);
    expect(stored).toBe(await trimEdgeBars(core, barredHash));
  });

  it('cuts a baked-in edge bar off a frame, and leaves a clean one alone', async () => {
    // A lit sweep with flat bands down both sides: the exact failure the
    // anti-border clause in the prompt does not reliably prevent.
    const W = 200;
    const H = 250;
    const raw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const bar = x < 20 || x >= W - 20;
        // Bars are flat and lighter; the sweep behind the subject varies.
        const v = bar ? 250 : 120 + Math.round(40 * Math.sin((x / W) * Math.PI)) + (y % 7);
        raw.fill(v, (y * W + x) * 3, (y * W + x) * 3 + 3);
      }
    }
    const barred = core.images.save(
      await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
        .png()
        .toBuffer(),
    );
    const trimmed = await trimEdgeBars(core, barred);
    expect(trimmed).not.toBe(barred);
    const meta = await sharp(core.images.read(trimmed)).metadata();
    expect(meta.width).toBe(W - 40);
    expect(meta.height).toBe(H);

    // A frame with no bar is handed back untouched, hash and all.
    const clean = core.images.save(await png('#3a5f7d'));
    expect(await trimEdgeBars(core, clean)).toBe(clean);
  });

  it('describes the empty set without naming anything staged in it', () => {
    const prompt = scenePreviewPrompt({ prompt: 'A basalt shelf.', lighting: 'Low sun' } as CustomScene);
    expect(prompt).toContain('A basalt shelf.');
    expect(prompt).toContain('Low sun');
    expect(prompt).toMatch(/no product, no person/);
  });

  // The plate conditions figure-led generations now. A blanket word ban drew
  // typographic treatments print-free, which conditioned the treatment away;
  // print inside the treatment follows the fictional-brands doctrine, and
  // everywhere else stays clean.
  it('a treatment plate may carry fictional print; a plain figure plate stays word-free', () => {
    const treated = scenePreviewPrompt({
      prompt: 'A close portrait world.',
      figure: 'one figure at close range',
      figureTreatment: 'the face tiled with printed stickers',
    } as CustomScene);
    expect(treated).toContain('nobody in particular');
    expect(treated).toContain('plausible but fictional, resembling no existing brand');
    expect(treated).toContain('Everywhere outside the treatment, no logos and no readable words');
    expect(treated).not.toContain('no readable words anywhere in the frame');

    const plain = scenePreviewPrompt({
      prompt: 'A close portrait world.',
      figure: 'one figure at close range',
    } as CustomScene);
    expect(plain).toContain('nobody in particular');
    expect(plain).toContain('no readable words anywhere in the frame');
    expect(plain).not.toContain('plausible but fictional');
  });

  /* ------------------------------------------------------ around the edges */

  it('reports what this install can actually do before anything is promised', async () => {
    const caps = (await app.inject({ method: 'GET', url: '/api/asset-builds/capabilities' })).json();
    expect(caps).toMatchObject({ canAnalyze: true, canGenerate: true, engineId: 'spy', free: true });

    await app.close();
    engineAvailable = false;
    app = start({ analyzer: analyzer(false) });
    const off = (await app.inject({ method: 'GET', url: '/api/asset-builds/capabilities' })).json();
    expect(off).toMatchObject({ canAnalyze: false, canGenerate: false, engineId: null });
    expect(off.analyzeReason).toBe('no codex');
  });

  it('carries both kinds into a .brand bundle, evidence included', async () => {
    const brand = await newBrand();
    await runBuild(brand.id, { kind: 'presenter', name: 'Mara', imageHashes: [await savePhoto()] });
    await buildScene(brand.id, { kind: 'scene', name: 'Shore', instruction: 'a volcanic beach', imageHashes: [] });

    const res = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/export` });
    expect(res.statusCode).toBe(200);
    const zip = await JSZip.loadAsync(res.rawPayload);
    const json = JSON.parse(await (zip.file('brand.json') as any).async('string'));
    expect(json.scenes).toHaveLength(1);
    expect(json.characters[0].sourceRefs[0].file).toMatch(/^assets\/characters\/up-[a-f0-9]{8}-source-01\.png$/);
    expect(json.characters[0].preview).toMatch(/^assets\/characters\/up-[a-f0-9]{8}-card\.png$/);
    // The cover is one of the frames, so the bundle holds it once, under the
    // frame's own path, and the preview points there.
    expect(json.scenes[0].refs.map((r: any) => r.file)).toContain(json.scenes[0].preview);
    // A drawn frame stays marked as drawn in the bundle, beside its rewritten path.
    expect(json.scenes[0].refs[0]).toMatchObject({ drawn: true });
    expect(json.scenes[0].refs[0].file).toMatch(/^assets\/scenes\/us-[a-f0-9]{8}-ref-01\.png$/);
    for (const path of [json.characters[0].sourceRefs[0].file, json.scenes[0].preview, json.scenes[0].refs[0].file]) {
      expect(zip.file(path)).toBeTruthy();
    }
  });

  it('cancels a build in flight', async () => {
    const brand = await newBrand();
    const started = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/asset-builds`,
      payload: { kind: 'presenter', name: 'Mara', imageHashes: [await savePhoto()] },
    });
    const { jobId } = started.json();
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/asset-builds/${jobId}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    for (let i = 0; i < 200; i++) {
      const job = (await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/asset-builds/${jobId}` })).json();
      if (job.finished) {
        expect(job.stage).toBe('cancelled');
        return;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('cancelled build never settled');
  });

  it('forgets a build that is over, refuses one still running, and refuses another brand’s', async () => {
    const brand = await newBrand();
    const other = await newBrand();
    const { jobId } = (
      await app.inject({
        method: 'POST',
        url: `/api/brands/${brand.id}/asset-builds`,
        payload: { kind: 'presenter', name: 'Mara', imageHashes: [await savePhoto()] },
      })
    ).json();

    // still in flight: forgetting it would orphan the child process
    const early = await app.inject({ method: 'DELETE', url: `/api/brands/${brand.id}/asset-builds/${jobId}` });
    expect(early.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/asset-builds/${jobId}` })).statusCode).toBe(
      200,
    );

    await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/asset-builds/${jobId}/cancel` });
    for (let i = 0; i < 200; i++) {
      const job = (await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/asset-builds/${jobId}` })).json();
      if (job.finished) break;
      await new Promise((r) => setTimeout(r, 5));
    }

    const foreign = await app.inject({ method: 'DELETE', url: `/api/brands/${other.id}/asset-builds/${jobId}` });
    expect(foreign.statusCode).toBe(404);

    const gone = await app.inject({ method: 'DELETE', url: `/api/brands/${brand.id}/asset-builds/${jobId}` });
    expect(gone.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/asset-builds/${jobId}` })).statusCode).toBe(
      404,
    );
  });

  it('keeps one brand’s builds out of another’s', async () => {
    const mine = await newBrand();
    const theirs = await newBrand();
    const { jobId } = (
      await app.inject({
        method: 'POST',
        url: `/api/brands/${mine.id}/asset-builds`,
        payload: { kind: 'scene', name: 'Shore', instruction: 'a beach', imageHashes: [] },
      })
    ).json();
    const res = await app.inject({ method: 'GET', url: `/api/brands/${theirs.id}/asset-builds/${jobId}` });
    expect(res.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/brands/${theirs.id}/asset-builds` })).json().builds).toEqual(
      [],
    );
  });
  /* --------------------------------------------------- the staged build */

  describe('the staged scene build', () => {
    const purposes = (job: any) => job.frames.filter((f: any) => f.status === 'landed').map((f: any) => f.purpose);
    const hashes = (job: any) => job.frames.filter((f: any) => f.status === 'landed').map((f: any) => f.hash);

    it('draws the seed and waits; yes draws the views from the seed and the record; save writes the set', async () => {
      const brand = await newBrand();
      const jobId = await startScene(brand.id, {
        kind: 'scene',
        instruction: 'a volcanic beach at dusk',
        imageHashes: [],
      });
      let job = await waitStage(brand.id, jobId, 'awaiting');
      expect(job.stage).toBe('awaiting');
      expect(job.name).toBe('');
      expect(job.suggestedName).toBe('Wet Basalt Shore');
      expect(job.record.prompt).toContain('basalt');
      expect(purposes(job)).toEqual(['seed']);
      expect(job.cover).toBe(job.frames[0].hash);
      expect(job.stageAt.seeding).toBeTruthy();
      // Nothing was uploaded, so the seed is drawn from the words alone.
      expect(generated).toHaveLength(1);
      expect(generated[0].referenceImages).toBeUndefined();

      expect((await act(brand.id, jobId, 'approve')).statusCode).toBe(200);
      job = await waitStage(brand.id, jobId, 'reviewing');
      expect(job.stage).toBe('reviewing');
      expect(purposes(job)).toEqual(['seed', 'wide', 'surface', 'angle']);
      expect(job.step).toBe(4);
      expect(job.steps).toBe(4);
      const seedPath = core.images.pathFor(job.frames[0].hash);
      // Every view is drawn from the locked record with the seed attached
      // first, then what landed before it, never chained on one predecessor
      // alone, and never on an upload.
      for (const req of generated.slice(1)) {
        expect(req.referenceImages?.[0]).toBe(seedPath);
        expect(req.referenceRoles?.every((r) => r === 'scene')).toBe(true);
        expect(req.referenceImages!.length).toBeLessThanOrEqual(4);
        expect(req.prompt).toContain(job.record.prompt);
        expect(req.prompt).toContain(WORLD_CLAUSE);
      }
      expect(generated[1].referenceImages).toHaveLength(1);
      expect(generated[3].referenceImages).toHaveLength(3);
      expect(generated[1].prompt).toContain('wide establishing photograph');
      expect(generated[2].prompt).toContain('the wide layout described above is not in this frame');
      expect(generated[3].prompt).toContain('different camera height');

      const r = await act(brand.id, jobId, 'finish', { name: 'Dusk Shore' });
      expect(r.statusCode).toBe(200);
      job = await settle(brand.id, jobId);
      expect(job.stage).toBe('done');
      expect(job.step).toBe(job.steps);
      const scene = brandJson(brand.id).scenes[0];
      expect(job.assetId).toBe(scene.id);
      expect(scene.name).toBe('Dusk Shore');
      expect(scene.refs).toHaveLength(4);
      expect(scene.refs.every((x: any) => x.drawn === true)).toBe(true);
      expect(scene.preview).toBe(`asset:${job.frames[0].hash}`);
      expect(scene.instruction).toBe('a volcanic beach at dusk');
      // The set was read back once, as a revision of the locked record.
      expect(analyzed).toHaveLength(2);
      expect(analyzed[1].correction).toBe(CONSENSUS_NOTE);
      expect(analyzed[1].priorDraft.id).toBe(scene.id);
      expect(analyzed[1].imagePaths).toEqual(hashes(job).map((h: string) => core.images.pathFor(h)));
      expect(scene.prompt).toContain('read across the whole set');
      // Every frame is still on disk, and each is exactly one draw.
      for (const h of hashes(job)) expect(core.images.has(h)).toBe(true);
      expect(generated).toHaveLength(4);
    });

    it('yes locks the record: adjusting after is refused, the reading stands, and the figure survives the read-back', async () => {
      const brand = await newBrand();
      const jobId = await startScene(brand.id, { kind: 'scene', instruction: 'a volcanic beach', imageHashes: [] });
      const before = await waitStage(brand.id, jobId, 'awaiting');
      await act(brand.id, jobId, 'approve');
      let job = await waitStage(brand.id, jobId, 'reviewing');
      // Busy or paused, a second reading is over.
      const late = await act(brand.id, jobId, 'adjust', { note: 'colder' });
      expect(late.statusCode).toBe(409);
      await act(brand.id, jobId, 'finish', { name: 'Shore' });
      job = await settle(brand.id, jobId);
      const scene = brandJson(brand.id).scenes[0];
      expect(scene.id).toBe(before.record.id);
      // The read-back answered with no figure at all; the locked one stands.
      expect(scene.figure).toBe(before.record.figure);
      expect(scene.figureTreatment).toBe(before.record.figureTreatment);
      expect(scene.subject).toBe(before.record.subject);
    });

    it('asked not to read the set back, it reads once and keeps the approved prompt', async () => {
      const brand = await newBrand();
      const { job } = await buildScene(brand.id, {
        kind: 'scene',
        instruction: 'a volcanic beach',
        imageHashes: [],
        consensus: false,
      });
      expect(job.stage).toBe('done');
      expect(analyzed).toHaveLength(1);
      expect(brandJson(brand.id).scenes[0].prompt).toBe('A wet dark basalt shelf at low sunset light.');
    });

    it('try again redraws the seed on the same reading; adjust reads again with the record as prior', async () => {
      const brand = await newBrand();
      const jobId = await startScene(brand.id, { kind: 'scene', instruction: 'a volcanic beach', imageHashes: [] });
      let job = await waitStage(brand.id, jobId, 'awaiting');
      const first = job.frames[0].hash;
      const id = job.record.id;

      expect((await act(brand.id, jobId, 'retry')).statusCode).toBe(200);
      job = await waitStage(brand.id, jobId, 'awaiting');
      expect(hashes(job)).toHaveLength(1);
      expect(hashes(job)[0]).not.toBe(first);
      expect(job.frames.find((f: any) => f.hash === first).status).toBe('rejected');
      expect(job.cover).toBe(hashes(job)[0]);
      expect(analyzed).toHaveLength(1);
      expect(job.record.id).toBe(id);

      expect((await act(brand.id, jobId, 'adjust', { note: 'colder, less orange' })).statusCode).toBe(200);
      job = await waitStage(brand.id, jobId, 'awaiting');
      expect(analyzed).toHaveLength(2);
      expect(analyzed[1].correction).toBe('colder, less orange');
      expect(analyzed[1].priorDraft.id).toBe(id);
      expect(analyzed[1].instruction).toBe('a volcanic beach');
      expect(job.record.id).toBe(id);
      expect(hashes(job)).toHaveLength(1);
      expect(generated).toHaveLength(3);
      // Nothing to change, nothing read.
      expect((await act(brand.id, jobId, 'adjust', { note: '   ' })).statusCode).toBe(400);
    });

    it('redrawing one view keeps the others; removing one below the target draws a replacement; nobody keeps the rejects', async () => {
      const brand = await newBrand();
      const jobId = await startScene(brand.id, { kind: 'scene', instruction: 'a volcanic beach', imageHashes: [] });
      await waitStage(brand.id, jobId, 'awaiting');
      await act(brand.id, jobId, 'approve');
      let job = await waitStage(brand.id, jobId, 'reviewing');
      const [seed, wide, surface, angle] = hashes(job);

      expect((await act(brand.id, jobId, 'retry', { frame: wide })).statusCode).toBe(200);
      job = await waitStage(brand.id, jobId, 'reviewing');
      const after = hashes(job);
      expect(after).toHaveLength(4);
      expect(after).toContain(seed);
      expect(after).toContain(surface);
      expect(after).toContain(angle);
      expect(after).not.toContain(wide);
      expect(purposes(job)).toEqual(['seed', 'surface', 'angle', 'wide']);

      expect((await act(brand.id, jobId, `frame/${angle}`, undefined, 'DELETE')).statusCode).toBe(200);
      job = await waitStage(brand.id, jobId, 'reviewing');
      expect(hashes(job)).toHaveLength(4);
      expect(hashes(job)).not.toContain(angle);
      expect(purposes(job).sort()).toEqual(['angle', 'seed', 'surface', 'wide']);

      await act(brand.id, jobId, 'finish', { name: 'Shore' });
      job = await settle(brand.id, jobId);
      const scene = brandJson(brand.id).scenes[0];
      const kept = scene.refs.map((r: any) => r.file.slice(6));
      expect(kept).not.toContain(wide);
      expect(kept).not.toContain(angle);
      expect(kept).toHaveLength(4);
      // The rejects are gone from disk; what was kept is not.
      expect(core.images.has(wide)).toBe(false);
      expect(core.images.has(angle)).toBe(false);
      for (const h of kept) expect(core.images.has(h)).toBe(true);
    });

    it('the cover is any frame for a place, and only a drawn frame for a world built around a figure', async () => {
      const brand = await newBrand();
      const upload = await savePhoto('#123456');
      // A place: the upload may be the card.
      const place = await buildScene(
        brand.id,
        { kind: 'scene', instruction: 'an empty basalt shore', imageHashes: [upload] },
        { cover: upload },
      );
      expect(place.job.stage).toBe('done');
      const placeScene = brandJson(brand.id).scenes[0];
      expect(placeScene.figure).toBeUndefined();
      expect(placeScene.preview).toBe(`asset:${upload}`);
      // And that card never reaches a shot: a scene contributes words only.
      const preview = await app.inject({
        method: 'POST',
        url: '/api/brief/preview',
        payload: { brandId: brand.id, engineId: 'spy', brief: { tokens: [{ t: 'template', id: placeScene.id }] } },
      });
      expect(preview.json().referenceCount).toBe(0);

      // A figure-led world: the cover is the plate a presenter is shown beside,
      // so a raw upload of a real person is refused; the seed is the default.
      const jobId = await startScene(brand.id, { kind: 'scene', instruction: 'a shore', imageHashes: [upload] });
      await waitStage(brand.id, jobId, 'awaiting');
      await act(brand.id, jobId, 'approve');
      const job = await waitStage(brand.id, jobId, 'reviewing');
      const refused = await act(brand.id, jobId, 'finish', { name: 'Figure', cover: upload });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error).toMatch(/plate/);
      expect((await act(brand.id, jobId, 'finish', { name: 'Figure', cover: hashes(job)[1] })).statusCode).toBe(200);
      await settle(brand.id, jobId);
      const figureScene = brandJson(brand.id).scenes[1];
      expect(figureScene.figure).toBeTruthy();
      expect(figureScene.preview).toBe(`asset:${hashes(job)[1]}`);
      expect(figureScene.refs.find((r: any) => r.file === figureScene.preview).drawn).toBe(true);
    });

    it('three uploads are a set already: no seed, straight to review; add a view draws one from the uploads', async () => {
      const brand = await newBrand();
      const uploads = [await savePhoto('#111111'), await savePhoto('#222222'), await savePhoto('#333333')];
      const jobId = await startScene(brand.id, { kind: 'scene', instruction: 'an empty shore', imageHashes: uploads });
      let job = await waitStage(brand.id, jobId, 'awaiting', 'reviewing');
      expect(job.stage).toBe('reviewing');
      expect(generated).toHaveLength(0);
      expect(purposes(job)).toEqual(['upload', 'upload', 'upload']);
      expect(job.suggestedName).toBe('Wet Basalt Shore');

      expect((await act(brand.id, jobId, 'add-view')).statusCode).toBe(200);
      job = await waitStage(brand.id, jobId, 'reviewing');
      expect(generated).toHaveLength(1);
      expect(generated[0].referenceImages).toEqual(uploads.map((h) => core.images.pathFor(h)));
      expect(generated[0].prompt).toContain(WORLD_CLAUSE);
      expect(generated[0].prompt).toContain('wide establishing');
      expect(purposes(job)).toEqual(['upload', 'upload', 'upload', 'wide']);

      await act(brand.id, jobId, 'finish', { name: 'Shore', cover: uploads[1] });
      job = await settle(brand.id, jobId);
      const scene = brandJson(brand.id).scenes[0];
      expect(scene.refs.map((r: any) => r.file)).toEqual([...uploads, hashes(job)[3]].map((h) => `asset:${h}`));
      expect(scene.refs.slice(0, 3).every((r: any) => r.drawn === undefined)).toBe(true);
      expect(scene.refs[3].drawn).toBe(true);
      expect(scene.preview).toBe(`asset:${uploads[1]}`);
    });

    it('three uploads of a figure-led world still draw the seed, so the plate is never a raw upload', async () => {
      const brand = await newBrand();
      const uploads = [await savePhoto('#444444'), await savePhoto('#555555'), await savePhoto('#666666')];
      const jobId = await startScene(brand.id, { kind: 'scene', imageHashes: uploads });
      let job = await waitStage(brand.id, jobId, 'awaiting', 'reviewing');
      expect(job.stage).toBe('awaiting');
      expect(generated).toHaveLength(1);
      expect(generated[0].referenceImages).toHaveLength(3);
      await act(brand.id, jobId, 'approve');
      job = await waitStage(brand.id, jobId, 'reviewing');
      // Enough uploads: no views after the seed.
      expect(generated).toHaveLength(1);
      expect(purposes(job)).toEqual(['upload', 'upload', 'upload', 'seed']);
    });

    it('one upload is enough: the seed is drawn from it and the views never see it', async () => {
      const brand = await newBrand();
      const upload = await savePhoto('#777777');
      const { job } = await buildScene(brand.id, {
        kind: 'scene',
        instruction: 'an empty shore',
        imageHashes: [upload],
      });
      expect(job.stage).toBe('done');
      expect(generated[0].referenceImages).toEqual([core.images.pathFor(upload)]);
      const seedPath = core.images.pathFor(job.frames.find((f: any) => f.origin === 'seed').hash);
      for (const req of generated.slice(1)) {
        expect(req.referenceImages?.[0]).toBe(seedPath);
        expect(req.referenceImages).not.toContain(core.images.pathFor(upload));
      }
      expect(brandJson(brand.id).scenes[0].refs).toHaveLength(4);
    });

    it('a set of six walks the whole ladder, and a view never carries more than the seed and three others', async () => {
      const brand = await newBrand();
      const { job } = await buildScene(brand.id, {
        kind: 'scene',
        instruction: 'a volcanic beach',
        imageHashes: [],
        target: 6,
      });
      expect(job.stage).toBe('done');
      expect(purposes(job)).toEqual(['seed', 'wide', 'surface', 'angle', 'light', 'zone']);
      expect(generated).toHaveLength(6);
      expect(generated[5].referenceImages).toHaveLength(4);
      expect(generated[4].prompt).toContain('other way from the main source of light');
      expect(generated[5].prompt).toContain('second part of the same place');
      expect(brandJson(brand.id).scenes[0].refs).toHaveLength(6);
    });

    it('a world built around a figure keeps that figure, and nobody in particular, in every view', async () => {
      const brand = await newBrand();
      const { job } = await buildScene(brand.id, { kind: 'scene', instruction: 'a shore', imageHashes: [] });
      expect(job.record.figure).toBeTruthy();
      for (const req of generated.slice(1)) {
        expect(req.prompt).toContain(FIGURE_VIEW_CLAUSE);
        expect(req.prompt).toContain('A figure is in this photograph');
      }
      expect(generated[2].prompt).toContain("close photograph of the figure's treatment");
      // The prompt builder itself, for the record.
      const words = sceneViewPrompt({ prompt: 'A shelf.', lighting: 'Low sun' } as CustomScene, 'surface');
      expect(words).toContain('no product, no person');
      expect(words).not.toContain(FIGURE_VIEW_CLAUSE);
      expect(sceneViewPrompt({ prompt: 'A shelf.' } as CustomScene, 'upload')).toBe(
        scenePreviewPrompt({ prompt: 'A shelf.' } as CustomScene),
      );
    });

    it('refuses what the stage is not waiting for, and a set outside four to six', async () => {
      const brand = await newBrand();
      for (const target of [3, 9, 4.5]) {
        const r = await app.inject({
          method: 'POST',
          url: `/api/brands/${brand.id}/asset-builds`,
          payload: { kind: 'scene', instruction: 'a shore', imageHashes: [], target },
        });
        expect(r.statusCode).toBe(400);
      }
      const upload = await savePhoto('#888888');
      const jobId = await startScene(brand.id, { kind: 'scene', instruction: 'a shore', imageHashes: [upload] });
      let job = await waitStage(brand.id, jobId, 'awaiting');
      expect((await act(brand.id, jobId, 'finish', { name: 'x' })).statusCode).toBe(409);
      expect((await act(brand.id, jobId, 'add-view')).statusCode).toBe(409);
      expect((await act(brand.id, jobId, 'retry', { frame: upload })).statusCode).toBe(400);
      expect((await act(brand.id, jobId, `frame/${job.frames[1].hash}`, undefined, 'DELETE')).statusCode).toBe(409);
      await act(brand.id, jobId, 'approve');
      job = await waitStage(brand.id, jobId, 'reviewing');
      expect((await act(brand.id, jobId, 'approve')).statusCode).toBe(409);
      expect((await act(brand.id, jobId, 'retry', { frame: job.frames[1].hash })).statusCode).toBe(400);
      const seedRemove = await act(brand.id, jobId, `frame/${job.frames[1].hash}`, undefined, 'DELETE');
      expect(seedRemove.statusCode).toBe(400);
      expect((await act(brand.id, jobId, 'finish', { name: '' })).statusCode).toBe(400);
      expect((await act(brand.id, jobId, 'finish', { name: 'x', cover: 'not-a-frame' })).statusCode).toBe(400);
      expect((await act(brand.id, jobId, `frame/nope`, undefined, 'DELETE')).statusCode).toBe(404);
      // A presenter build is not a staged scene.
      const presenter = (
        await app.inject({
          method: 'POST',
          url: `/api/brands/${brand.id}/asset-builds`,
          payload: { kind: 'presenter', name: 'Mara', imageHashes: [upload] },
        })
      ).json().jobId;
      expect((await act(brand.id, presenter, 'approve')).statusCode).toBe(400);
      await settle(brand.id, presenter);
    });

    it('one scene at a time per brand: the second start is handed the first', async () => {
      const brand = await newBrand();
      const jobId = await startScene(brand.id, { kind: 'scene', instruction: 'a shore', imageHashes: [] });
      await waitStage(brand.id, jobId, 'awaiting');
      const again = await app.inject({
        method: 'POST',
        url: `/api/brands/${brand.id}/asset-builds`,
        payload: { kind: 'scene', instruction: 'another shore', imageHashes: [] },
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().jobId).toBe(jobId);
      // Another brand is not in the way.
      const other = await newBrand();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/brands/${other.id}/asset-builds`,
            payload: { kind: 'scene', instruction: 'a shore', imageHashes: [] },
          })
        ).statusCode,
      ).toBe(200);
    });

    it('a build waiting for its person counts as running, and stopping it takes its frames back', async () => {
      const brand = await newBrand();
      const upload = await savePhoto('#999999');
      const jobId = await startScene(brand.id, { kind: 'scene', instruction: 'a shore', imageHashes: [upload] });
      await waitStage(brand.id, jobId, 'awaiting');
      await act(brand.id, jobId, 'approve');
      const job = await waitStage(brand.id, jobId, 'reviewing');
      expect(runningAssetBuildCount()).toBe(1);
      const drawn = hashes(job).filter((h: string) => h !== upload);
      expect(drawn.length).toBeGreaterThan(0);
      expect((await act(brand.id, jobId, 'cancel')).statusCode).toBe(200);
      const over = await settle(brand.id, jobId);
      expect(over.stage).toBe('cancelled');
      expect(runningAssetBuildCount()).toBe(0);
      for (const h of drawn) expect(core.images.has(h)).toBe(false);
      expect(core.images.has(upload)).toBe(true);
      expect(brandJson(brand.id).scenes ?? []).toHaveLength(0);
    });

    it('a resumed build hands its approved frames back as images and keeps them marked drawn', async () => {
      const brand = await newBrand();
      const first = await startScene(brand.id, { kind: 'scene', instruction: 'an empty shore', imageHashes: [] });
      await waitStage(brand.id, first, 'awaiting');
      await act(brand.id, first, 'approve');
      const job = await waitStage(brand.id, first, 'reviewing');
      const approved = hashes(job);
      // The server forgot the job (a restart), but the frames are on disk.
      resetAssetBuilds();
      const again = await startScene(brand.id, {
        kind: 'scene',
        instruction: 'an empty shore',
        imageHashes: approved,
        drawnHashes: approved,
      });
      const resumed = await waitStage(brand.id, again, 'awaiting', 'reviewing');
      expect(resumed.stage).toBe('reviewing');
      await act(brand.id, again, 'finish', { name: 'Shore', cover: approved[1] });
      await settle(brand.id, again);
      const scene = brandJson(brand.id).scenes[0];
      expect(scene.refs.map((r: any) => r.file)).toEqual(approved.map((h: string) => `asset:${h}`));
      expect(scene.refs.every((r: any) => r.drawn === true)).toBe(true);
      expect(scene.preview).toBe(`asset:${approved[1]}`);
    });

    it('a record with plain refs keeps them plain through edits, and a drawn one keeps its marks', async () => {
      const brand = await newBrand();
      const upload = await savePhoto('#aaaaaa');
      const legacy = (
        await app.inject({
          method: 'POST',
          url: `/api/brands/${brand.id}/scenes`,
          payload: { ...SCENE_BODY, refHashes: [upload] },
        })
      ).json().scene;
      expect(legacy.refs).toEqual([{ file: `asset:${upload}` }]);
      await app.inject({
        method: 'PATCH',
        url: `/api/brands/${brand.id}/scenes/${legacy.id}`,
        payload: { prompt: 'A wet basalt shelf, colder.' },
      });
      expect(brandJson(brand.id).scenes[0].refs).toEqual([{ file: `asset:${upload}` }]);

      const { job } = await buildScene(brand.id, { kind: 'scene', instruction: 'an empty shore', imageHashes: [] });
      const drawn = brandJson(brand.id).scenes[1];
      expect(drawn.refs.every((r: any) => r.drawn === true)).toBe(true);
      // A PATCH that resends the list without saying which are drawn keeps the marks.
      const resent = await app.inject({
        method: 'PATCH',
        url: `/api/brands/${brand.id}/scenes/${drawn.id}`,
        payload: { refHashes: hashes(job) },
      });
      expect(resent.statusCode).toBe(200);
      expect(brandJson(brand.id).scenes[1].refs.every((r: any) => r.drawn === true)).toBe(true);
    });
  });
});
