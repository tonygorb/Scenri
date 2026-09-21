import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EditRequest, type EngineAdapter, type GenerateRequest } from '@scenri/core';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { resetAssetBuilds } from '../src/customAssets.js';
import { withOwnLight } from '../src/brief.js';
import {
  nameFromWords,
  readingFrom,
  resetSceneStudio,
  sceneChangePrompt,
  type SceneReading,
} from '../src/sceneStudio.js';

const READ: SceneReading = {
  name: 'Wet Basalt Shore',
  prompt: 'A wet dark basalt shelf at the waterline, cool ocean haze behind.',
  lighting: 'Low directional sunset',
  subject: 'product',
  description: 'A dark volcanic shoreline at last light.',
};

describe('the scene studio', () => {
  let home: string;
  let templatesDir: string;
  let core: Core;
  let app: FastifyInstance;
  let generated: GenerateRequest[];
  let edited: EditRequest[];
  let analyzed: any[];
  /** The next analyzer answer; figure-led when set. */
  let figure: string | undefined;
  /** Held open until released, for the cases that need work in flight. */
  let gate: Promise<void> | null;

  const png = (tint: string) =>
    sharp({ create: { width: 64, height: 80, channels: 3, background: tint } })
      .png()
      .toBuffer();

  const engine = (opts: { edit?: boolean } = {}): EngineAdapter => ({
    capabilities: () => ({
      id: 'spy',
      displayName: 'Spy',
      localOnly: false,
      supportsEdit: opts.edit ?? true,
      supportsMask: false,
      maxReferenceImages: 5,
    }),
    isAvailable: async () => ({ ok: true }),
    costEstimate: async () => 0,
    generate: async (req) => {
      generated.push(req);
      if (gate) await gate;
      const shade = (0x20 + generated.length * 0x13).toString(16).padStart(2, '0');
      return { images: [core.images.save(await png(`#${shade}4050`))], costUsd: 0 };
    },
    edit: async (req) => {
      edited.push(req);
      const shade = (0x30 + edited.length * 0x17).toString(16).padStart(2, '0');
      return { images: [core.images.save(await png(`#50${shade}60`))], costUsd: 0 };
    },
  });

  const analyzer = (available = true) => ({
    isAvailable: async () => (available ? { ok: true } : { ok: false, reason: 'no codex' }),
    analyze: async (req: any, signal?: AbortSignal) => {
      analyzed.push(req);
      if (gate) await gate;
      if (signal?.aborted) throw new Error('aborted');
      const revising = !!req.priorDraft;
      return {
        name: revising ? req.priorDraft.name : 'Wet Basalt Shore',
        promptName: 'Wet Basalt Shore',
        lighting: revising ? 'Early morning, soft and warm' : 'Low directional sunset',
        description: 'A dark volcanic shoreline.',
        subject: 'product' as const,
        collections: ['Editorial'],
        verticals: ['Beauty'],
        keywords: ['volcanic'],
        prompt: revising ? `${req.priorDraft.prompt} Warmer.` : READ.prompt,
        ...(figure ? { figure } : {}),
        coverage: ['A wider frame would pin down the bay.'],
      };
    },
  });

  const start = (opts: { analyzer?: any; engine?: EngineAdapter | null } = {}) => {
    const e = opts.engine === undefined ? engine() : opts.engine;
    return buildServer({
      core,
      engines: { all: () => (e ? [e] : []), get: (id) => (e && id === 'spy' ? e : null) },
      templatesDir,
      analyzer: opts.analyzer ?? analyzer(),
    });
  };

  /** Another install over the same home: the drain closes the core, so a new one opens it. */
  const restart = async (opts: { analyzer?: any; engine?: EngineAdapter | null }) => {
    await app.drain();
    core = createCore(home);
    app = start(opts);
  };

  beforeEach(() => {
    resetAssetBuilds();
    resetSceneStudio();
    generated = [];
    edited = [];
    analyzed = [];
    figure = undefined;
    gate = null;
    templatesDir = mkdtempSync(join(tmpdir(), 'sc-studio-templates-'));
    mkdirSync(join(templatesDir, 'presenters'), { recursive: true });
    home = mkdtempSync(join(tmpdir(), 'sc-studio-home-'));
    core = createCore(home);
    app = start();
  });

  afterEach(async () => {
    gate = null;
    await app.drain();
    resetSceneStudio();
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
    ).json();

  const photo = async (tint = '#884422') => core.images.save(await png(tint));

  const startJob = (brandId: string, payload: any) =>
    app.inject({ method: 'POST', url: `/api/brands/${brandId}/scene-studio/jobs`, payload });

  const settle = async (brandId: string, jobId: string) => {
    for (let i = 0; i < 400; i++) {
      const job = (
        await app.inject({ method: 'GET', url: `/api/brands/${brandId}/scene-studio/jobs/${jobId}` })
      ).json();
      if (job.status !== 'running') return job;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('job never finished');
  };

  const run = async (brandId: string, payload: any) => {
    const res = await startJob(brandId, payload);
    expect(res.statusCode, res.body).toBe(200);
    return settle(brandId, res.json().jobId);
  };

  it('reads the written words into a place and draws them', async () => {
    const brand = await newBrand();
    const job = await run(brand.id, { kind: 'make', instruction: 'a basalt shore at sunset' });
    expect(job.status).toBe('done');
    expect(job.reading.prompt).toBe(READ.prompt);
    expect(job.reading.name).toBe('Wet Basalt Shore');
    expect(job.hash).toMatch(/^[a-f0-9]{32}$/);
    expect(analyzed).toHaveLength(1);
    expect(generated).toHaveLength(1);
    expect(generated[0].prompt).toContain(READ.prompt);
    // a studio job never writes a scene: only Use does
    expect((core.store.getBrand(brand.id)?.json as any)?.scenes ?? []).toEqual([]);
  });

  it('draws a place from the pictures it was read from, not from the words alone', async () => {
    const brand = await newBrand();
    const a = await photo('#112233');
    const b = await photo('#445566');
    const job = await run(brand.id, { kind: 'make', instruction: 'the shore', imageHashes: [a, b] });
    expect(job.status).toBe('done');
    // the pictures were read
    expect(analyzed[0].imagePaths).toHaveLength(2);
    // and drawn from, as scene references, so the place is the one that was uploaded
    expect(generated[0].referenceImages).toHaveLength(2);
    expect(generated[0].referenceRoles).toEqual(['scene', 'scene']);
  });

  it('draws a figure-led scene with its pictures, because its preview is the plate a shot conditions on', async () => {
    figure = 'one person at close portrait range, squared to camera';
    const brand = await newBrand();
    const a = await photo();
    const job = await run(brand.id, { kind: 'make', imageHashes: [a] });
    expect(job.reading.figure).toBe(figure);
    expect(generated[0].referenceImages).toHaveLength(1);
    expect(generated[0].referenceRoles).toEqual(['scene']);
  });

  it('reads only, when asked not to draw', async () => {
    const brand = await newBrand();
    const job = await run(brand.id, { kind: 'make', instruction: 'the shore', draw: false });
    expect(job.reading.prompt).toBe(READ.prompt);
    expect(job.hash).toBeNull();
    expect(analyzed).toHaveLength(1);
    expect(generated).toHaveLength(0);
  });

  it('draws the same words again without reading anything', async () => {
    const brand = await newBrand();
    const job = await run(brand.id, { kind: 'again', reading: READ });
    expect(job.status).toBe('done');
    expect(job.hash).toMatch(/^[a-f0-9]{32}$/);
    expect(analyzed).toHaveLength(0);
    expect(generated[0].prompt).toContain(READ.prompt);
  });

  it('changes the words by one sentence and edits the picture from the one before', async () => {
    const brand = await newBrand();
    const before = await photo('#223344');
    const shots = await photo('#556677');
    const job = await run(brand.id, {
      kind: 'change',
      reading: READ,
      ask: 'make it warmer, early morning',
      from: before,
      imageHashes: [shots],
    });
    expect(job.status).toBe('done');
    // the words were revised, not read again from scratch
    expect(analyzed[0].priorDraft.prompt).toBe(READ.prompt);
    expect(analyzed[0].correction).toBe('make it warmer, early morning');
    expect(analyzed[0].imagePaths).toEqual([]);
    expect(job.reading.lighting).toBe('Early morning, soft and warm');
    // and the picture was changed, not drawn again
    expect(generated).toHaveLength(0);
    expect(edited).toHaveLength(1);
    expect(edited[0].sourceImage).toBe(core.images.pathFor(before));
    expect(edited[0].instruction).toContain('changed only in this: make it warmer, early morning');
  });

  it('reads the pictures again with a change only when they changed', async () => {
    const brand = await newBrand();
    const shots = await photo('#556677');
    await run(brand.id, { kind: 'change', reading: READ, ask: 'less polished', imageHashes: [shots], reread: true });
    expect(analyzed[0].imagePaths).toHaveLength(1);
  });

  it('attaches the old picture as the reference where the engine has no edit', async () => {
    await restart({ engine: engine({ edit: false }) });
    const brand = await newBrand();
    const before = await photo();
    await run(brand.id, { kind: 'change', reading: READ, ask: 'darker walls', from: before });
    expect(edited).toHaveLength(0);
    expect(generated[0].referenceImages).toEqual([core.images.pathFor(before)]);
    expect(generated[0].prompt).toContain('changed only in this: darker walls');
  });

  it('takes the words as written when nothing on the machine can read', async () => {
    await restart({ analyzer: analyzer(false) });
    const brand = await newBrand();
    const job = await run(brand.id, { kind: 'make', instruction: 'White cyclorama, hard flash from the left' });
    expect(job.reading.prompt).toBe('White cyclorama, hard flash from the left');
    expect(job.reading.name).toBe('White cyclorama');
    const changed = await run(brand.id, { kind: 'change', reading: job.reading, ask: 'a grey floor' });
    expect(changed.reading.prompt).toBe('White cyclorama, hard flash from the left. a grey floor');
  });

  it('refuses pictures alone when nothing can read them, before anything is spent', async () => {
    await restart({ analyzer: analyzer(false) });
    const brand = await newBrand();
    const res = await startJob(brand.id, { kind: 'make', imageHashes: [await photo()] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Reading pictures needs Codex');
    expect(generated).toHaveLength(0);
  });

  it('reads with no engine and says so by answering no picture', async () => {
    await restart({ engine: null });
    const brand = await newBrand();
    const job = await run(brand.id, { kind: 'make', instruction: 'the shore' });
    expect(job.status).toBe('done');
    expect(job.reading.prompt).toBe(READ.prompt);
    expect(job.hash).toBeNull();
    const again = await startJob(brand.id, { kind: 'again', reading: READ });
    expect(again.statusCode).toBe(400);
  });

  it('refuses what could never succeed', async () => {
    const brand = await newBrand();
    expect((await startJob(brand.id, { kind: 'make' })).statusCode).toBe(400);
    expect((await startJob(brand.id, { kind: 'change', reading: READ, ask: '  ' })).statusCode).toBe(400);
    expect((await startJob(brand.id, { kind: 'again' })).statusCode).toBe(400);
    const bad = await startJob(brand.id, { kind: 'again', reading: { ...READ, prompt: 'a {product} on stone' } });
    expect(bad.statusCode).toBe(400);
    expect((await startJob(brand.id, { kind: 'paint' })).statusCode).toBe(400);
  });

  it('stops when asked, and a stopped job keeps no picture', async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => {
      release = r;
    });
    const brand = await newBrand();
    const { jobId } = (await startJob(brand.id, { kind: 'make', imageHashes: [await photo()] })).json();
    const stop = await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scene-studio/jobs/${jobId}/cancel` });
    expect(stop.json().ok).toBe(true);
    release();
    const job = await settle(brand.id, jobId);
    expect(job.status).toBe('cancelled');
    expect(job.hash).toBeNull();
  });

  it('puts a picture still drawing onto the scene that was saved without it', async () => {
    const brand = await newBrand();
    const reading = await run(brand.id, { kind: 'make', instruction: 'the shore', draw: false });
    let release!: () => void;
    gate = new Promise<void>((r) => {
      release = r;
    });
    const { jobId } = (await startJob(brand.id, { kind: 'again', reading: reading.reading })).json();
    const saved = (
      await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scenes`, payload: { ...reading.reading } })
    ).json();
    const attach = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/scene-studio/jobs/${jobId}/attach`,
      payload: { sceneId: saved.scene.id },
    });
    expect(attach.json().state).toBe('pending');
    release();
    const job = await settle(brand.id, jobId);
    const rows: any[] = (core.store.getBrand(brand.id)?.json as any)?.scenes ?? [];
    const scene = rows.find((s) => s.id === saved.scene.id);
    expect(scene.preview).toBe(`asset:${job.hash}`);
  });

  it('runs one job per conversation: a second start is answered with the work already under way', async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => {
      release = r;
    });
    const brand = await newBrand();
    const first = (await startJob(brand.id, { kind: 'again', reading: READ, conversation: 'c-one' })).json();
    const again = (await startJob(brand.id, { kind: 'again', reading: READ, conversation: 'c-one' })).json();
    expect(again.jobId).toBe(first.jobId);
    expect(again.existing).toBe(true);
    // another conversation is other work
    const other = (await startJob(brand.id, { kind: 'again', reading: READ, conversation: 'c-two' })).json();
    expect(other.jobId).not.toBe(first.jobId);
    release();
    await settle(brand.id, first.jobId);
    await settle(brand.id, other.jobId);
    expect(generated).toHaveLength(2);
    // and once it is over, the conversation can start the next piece of work
    const next = (await startJob(brand.id, { kind: 'again', reading: READ, conversation: 'c-one' })).json();
    expect(next.jobId).not.toBe(first.jobId);
    expect(next.existing).toBeUndefined();
    await settle(brand.id, next.jobId);
  });

  it('never lands a picture the engine hands back after Stop', async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => {
      release = r;
    });
    const brand = await newBrand();
    const { jobId } = (await startJob(brand.id, { kind: 'again', reading: READ, conversation: 'c-late' })).json();
    const stop = await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scene-studio/jobs/${jobId}/cancel` });
    expect(stop.json().ok).toBe(true);
    // the spy engine ignores the abort and answers anyway, the way a remote provider does
    release();
    const job = await settle(brand.id, jobId);
    expect(generated).toHaveLength(1);
    expect(job.status).toBe('cancelled');
    expect(job.hash).toBeNull();
  });

  it('keeps a newer picture on a scene when an older draw lands after it', async () => {
    const brand = await newBrand();
    let release!: () => void;
    gate = new Promise<void>((r) => {
      release = r;
    });
    const { jobId } = (await startJob(brand.id, { kind: 'again', reading: READ })).json();
    const saved = (
      await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scenes`, payload: { ...READ } })
    ).json();
    const attach = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/scene-studio/jobs/${jobId}/attach`,
      payload: { sceneId: saved.scene.id },
    });
    expect(attach.json().state).toBe('pending');
    // the scene is saved again, with a picture of its own, while the old draw runs
    const newer = await photo('#224488');
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/brands/${brand.id}/scenes/${saved.scene.id}`,
      payload: { previewHash: newer },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    release();
    const job = await settle(brand.id, jobId);
    expect(job.status).toBe('done');
    const rows: any[] = (core.store.getBrand(brand.id)?.json as any)?.scenes ?? [];
    const scene = rows.find((s) => s.id === saved.scene.id);
    expect(scene.preview).toBe(`asset:${newer}`);
    expect(job.warnings.join(' ')).toMatch(/kept that one/);
  });

  it('puts a landed picture on at once', async () => {
    const brand = await newBrand();
    const job = await run(brand.id, { kind: 'again', reading: READ });
    const saved = (
      await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scenes`, payload: { ...READ } })
    ).json();
    const attach = await app.inject({
      method: 'POST',
      url: `/api/brands/${brand.id}/scene-studio/jobs/${job.id}/attach`,
      payload: { sceneId: saved.scene.id },
    });
    expect(attach.json().state).toBe('landed');
    const scene = (attach.json().brand.json.scenes as any[]).find((s) => s.id === saved.scene.id);
    expect(scene.preview).toBe(`asset:${job.hash}`);
  });

  it('tells a shot the light of a scene saved here, after its place', async () => {
    const brand = await newBrand();
    const saved = (
      await app.inject({ method: 'POST', url: `/api/brands/${brand.id}/scenes`, payload: { ...READ } })
    ).json();
    const res = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: { brandId: brand.id, engineId: 'spy', brief: { tokens: [{ t: 'template', id: saved.scene.id }] } },
    });
    expect(res.json().prompt).toContain(`${READ.prompt.replace(/\.$/, '')}. Low directional sunset.`);
  });

  it('keeps one brand out of another brand’s work', async () => {
    const mine = await newBrand();
    const theirs = await newBrand();
    const job = await run(mine.id, { kind: 'again', reading: READ });
    const peek = await app.inject({ method: 'GET', url: `/api/brands/${theirs.id}/scene-studio/jobs/${job.id}` });
    expect(peek.statusCode).toBe(404);
  });
});

describe('the words of a change', () => {
  it('holds every part of the place the sentence does not name', () => {
    const p = sceneChangePrompt(READ, 'make the walls darker.');
    expect(p).toContain('changed only in this: make the walls darker.');
    expect(p).toContain('the materials and surfaces');
    expect(p).toContain('the camera position and framing');
    // what the sentence is about is exactly what it must not forbid
    expect(p).not.toContain('identical to the attached image in the architecture');
    expect(p).not.toMatch(/identical to the attached image in [^.]*the light and the time of day/);
    expect(p).toContain(READ.prompt);
  });

  it('frees light and palette for a warmer place, and holds the architecture', () => {
    const p = sceneChangePrompt(READ, 'warmer');
    expect(p).toMatch(/identical to the attached image in the architecture and layout/);
    expect(p).not.toMatch(/identical to the attached image in [^.]*the colour palette/);
    expect(p).not.toMatch(/identical to the attached image in [^.]*the light/);
  });

  it('asks only for the same place when the sentence touches everything', () => {
    const p = sceneChangePrompt(READ, 'new room, raw concrete, night light, blue palette, heavy fog, low wide camera');
    expect(p).toContain('Keep it recognisably the same place.');
  });
});

describe('the light a shot is told', () => {
  const brand = { scenes: [{ id: 'us-1', lighting: 'Low sunset' }] };
  const own = { id: 'us-1', lighting: 'Low sunset' } as any;
  const catalog = { id: 'studio-shelf', lighting: 'Even softbox light' } as any;

  it('follows the place, for a scene the brand made', () => {
    expect(withOwnLight(own, brand, 'A basalt shelf.')).toBe('A basalt shelf. Low sunset.');
  });

  it('leaves the catalog as it is, byte for byte', () => {
    expect(withOwnLight(catalog, brand, 'A plaster shelf.')).toBe('A plaster shelf.');
  });

  it('never says the placeholder light, or a light the place already says', () => {
    const plain = { id: 'us-1', lighting: 'Even, neutral light' } as any;
    expect(withOwnLight(plain, { scenes: [plain] }, 'White cyclorama, hard flash.')).toBe(
      'White cyclorama, hard flash.',
    );
    expect(withOwnLight(own, brand, 'A basalt shelf in low sunset light.')).toBe('A basalt shelf in low sunset light.');
  });
});

describe('the words themselves', () => {
  it('names a place from the first words of its direction', () => {
    expect(nameFromWords('Warm brutalist hotel lobby at dusk, hard side light')).toBe('Warm brutalist hotel lobby');
    expect(nameFromWords('  white cyclorama ')).toBe('White cyclorama');
    expect(nameFromWords('')).toBe('New scene');
  });

  it('checks a reading by the rules a saved scene is held to', () => {
    const ok = readingFrom({ ...READ, figureTreatment: 'stickers' });
    expect(ok.ok && ok.reading.figureTreatment).toBeFalsy();
    const long = readingFrom({ ...READ, name: 'x'.repeat(90) });
    expect(long.ok && long.reading.name.length).toBe(60);
    expect(readingFrom({ ...READ, prompt: '' }).ok).toBe(false);
  });
});
