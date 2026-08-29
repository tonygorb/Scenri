import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';
import { createCore, type Core, type EngineAdapter, type GenerateRequest } from '@scenri/core';
import { buildServer } from '../src/server.js';
import {
  lintSceneProse,
  resetAssetBuilds,
  scenePreviewPrompt,
  trimEdgeBars,
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
            prompt: 'A wet dark basalt shelf at low sunset light.',
            camera: 'low three-quarter',
            figure: 'someone stands at the tide line, mid-ground, at human scale',
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
    templatesDir = mkdtempSync(join(tmpdir(), 'sc-custom-templates-'));
    mkdirSync(join(templatesDir, 'presenters'), { recursive: true });
    writeFileSync(join(templatesDir, `${CATALOG_SCENE.id}.json`), JSON.stringify(CATALOG_SCENE));
    home = mkdtempSync(join(tmpdir(), 'sc-custom-home-'));
    core = createCore(home);
    app = start();
  });

  afterEach(async () => {
    resetAssetBuilds();
    await app.close();
    core.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(templatesDir, { recursive: true, force: true });
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
    // The four normalized views are what a brief attaches.
    expect(person.shots).toHaveLength(4);
    expect(person.shots.every((s: any) => s.locked)).toBe(true);
    // The photographs are the evidence and are never replaced by a drawing.
    expect(person.sourceRefs.map((r: any) => r.file)).toEqual(photos.map((h) => `asset:${h}`));
    // Both thumbnails are crops of the first view, never pictures of their own,
    // so neither can show a different person than the references do.
    expect(person.preview).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(person.preview).not.toBe(person.shots[0].file);
    expect(person.avatar).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(person.avatar).not.toBe(person.preview);

    // The front view is drawn from the photographs; every other view chains off it.
    expect(generated).toHaveLength(4);
    expect(generated[0].referenceImages).toHaveLength(2);
    expect(generated[0].referenceRoles).toEqual(['character', 'character']);
    expect(generated[0].prompt).toContain('facing the camera straight-on');
    expect(generated[0].prompt).toContain('a woman in her early thirties with dark waves');
    // The capture uniform is a contract: the compiler's wardrobe-release
    // directive names it as neutral capture clothing, so the front frame must
    // keep drawing exactly this outfit — a drift here would quietly desync
    // what the release clause is releasing.
    expect(generated[0].prompt).toContain('off-white ribbed tank');
    for (const later of generated.slice(1)) expect(later.referenceImages).toHaveLength(1);
    expect(generated[3].prompt).toContain('back view');
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

    const scene = await runBuild(brand.id, {
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

  it('reaches a brief by promptName, attaching the first two views only', async () => {
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
    expect(compiled.attachments.filter((a: any) => a.role === 'character')).toHaveLength(2);
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
    expect(person.shots).toHaveLength(4); // untouched by a field edit

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
    const { job } = await runBuild(brand.id, {
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
    // The user's references are kept, and are the evidence a shot never sees.
    expect(scene.refs.map((r: any) => r.file)).toEqual(refs.map((h) => `asset:${h}`));
    expect(scene.preview).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(scene.width).toBe(1024);
    expect(scene.height).toBe(1280);

    expect(analyzed[0].vocabulary.collections).toContain('Studio');
    // A preview shows the world, not a stand-in product it would have to invent.
    expect(generated).toHaveLength(1);
    expect(generated[0].prompt).toContain('A figure is in this photograph');
    // The one draw with the whole reference budget to itself, and an output that
    // is a card rather than a customer's shot. So the world is read from pixels
    // here, and a shot still only ever gets the words.
    expect(generated[0].referenceImages).toHaveLength(refs.length);
    expect(generated[0].referenceRoles).toEqual(refs.map(() => 'scene'));
  });

  it('records the figure and its treatment, and never who it is', async () => {
    const brand = await newBrand();
    const { job } = await runBuild(brand.id, {
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
    const { job } = await runBuild(brand.id, {
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
    await runBuild(brand.id, {
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
    await runBuild(brand.id, {
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
    await runBuild(brand.id, {
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
    expect(analyzed[0].imagePaths).toHaveLength(1);
    expect(analyzed[0].priorDraft.id).toBe(before.id);
  });

  it('a re-read carries the direction the scene was built with', async () => {
    const brand = await newBrand();
    await runBuild(brand.id, {
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
    await runBuild(brand.id, {
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

  it('refuses a second read while the first is still running', async () => {
    const brand = await newBrand();
    await runBuild(brand.id, {
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
    await runBuild(brand.id, { kind: 'scene', name: 'Shore', instruction: 'a volcanic beach', imageHashes: [] });
    const id = brandJson(brand.id).scenes[0].id;
    const r = await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scenes/${id}/reread`, payload: {} });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/nothing to read again/);
  });

  it('builds a scene from words alone', async () => {
    const brand = await newBrand();
    const { job } = await runBuild(brand.id, {
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
    await runBuild(brand.id, { kind: 'scene', name: 'Shore', instruction: 'a volcanic beach', imageHashes: [] });

    const res = await app.inject({ method: 'GET', url: `/api/brands/${brand.id}/export` });
    expect(res.statusCode).toBe(200);
    const zip = await JSZip.loadAsync(res.rawPayload);
    const json = JSON.parse(await (zip.file('brand.json') as any).async('string'));
    expect(json.scenes).toHaveLength(1);
    expect(json.characters[0].sourceRefs[0].file).toMatch(/^assets\/characters\/up-[a-f0-9]{8}-source-01\.png$/);
    expect(json.characters[0].preview).toMatch(/^assets\/characters\/up-[a-f0-9]{8}-card\.png$/);
    expect(json.scenes[0].preview).toMatch(/^assets\/scenes\/us-[a-f0-9]{8}-preview\.png$/);
    for (const path of [json.characters[0].sourceRefs[0].file, json.scenes[0].preview]) {
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
});
