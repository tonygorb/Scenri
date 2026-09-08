import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter, type GenerateRequest } from '@scenri/core';
import { compileBrief } from '../src/brief.js';
import { brandCharacters, presenterCrops, resetAssetBuilds, type AssetBuildDeps } from '../src/customAssets.js';
import { CAPTURE_UNIFORM, PRESENTER_VIEWS } from '../src/presenterPrompts.js';
import {
  ABANDONED_DRAFT_MS,
  DEPENDS,
  approveView,
  createPresenterDraft,
  discardPresenterDraft,
  generateView,
  getPresenterDraft,
  planStep,
  redoView,
  resetPresenterDrafts,
  revertView,
  runningDraftJobCount,
  savePresenterDraft,
  sweepAbandonedPresenterDrafts,
  sweepPresenterDrafts,
  updatePresenterDraft,
  usePhotoForView,
  type PresenterDraftRecord,
} from '../src/presenterDrafts.js';
import { brandContext } from '../src/routes/shared.js';

/**
 * Casting a person, one approved view at a time.
 *
 * The rules under test are the ones the flow lives or dies on: an approved
 * view is what the next view is drawn from, regenerating a step never touches
 * an approved one, redoing an upstream view stales what was built on it, a
 * failure keeps the approved work, and what is saved is exactly what was
 * approved. The engine is a spy that records what it was handed.
 */

let home: string;
let core: Core;
let generated: GenerateRequest[];
let failNext: Error | null;
let analyzed: any[];
let analyzerOn: boolean;

const png = async (tint: string, w = 1024, h = 1280) =>
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
    if (failNext) {
      const err = failNext;
      failNext = null;
      throw err;
    }
    // a distinct picture per call, so hashes never collide across steps
    const shade = (0x20 + generated.length * 0x0b).toString(16).padStart(2, '0');
    return { images: [core.images.save(await png(`#${shade}4050`))], costUsd: 0 };
  },
  edit: async () => ({ images: [], costUsd: 0 }),
});

const analyzer = () => ({
  isAvailable: async () => (analyzerOn ? { ok: true } : { ok: false, reason: 'no codex' }),
  analyze: async (req: any) => {
    analyzed.push(req);
    return {
      promptName: 'a woman in her forties with a short silver crop',
      presentation: 'woman' as const,
      descriptor: 'Editorial · silver crop · composed',
      ageRange: 'mid 40s',
      hair: 'short silver crop',
      identityNotes: 'the strong brow and the silver crop must survive every generation',
      negativeConstraints: ['no long hair'],
      suitableCategories: ['Beauty'],
      coverage: [],
      facial: 'square jaw, strong brow',
      skin: 'fair with fine lines',
      build: 'tall and slender',
      ...(req.classifyPhotos
        ? {
            photos: req.imagePaths.map((_: string, i: number) => ({
              index: i,
              view: i === 0 ? 'portrait' : 'other',
              usable: true,
              note: i === 0 ? 'sharp, well lit' : 'a holiday snap',
            })),
          }
        : {}),
    };
  },
});

const deps = (): AssetBuildDeps => ({
  core,
  engine: engine(),
  analyzer: analyzerOn ? analyzer() : null,
  brandContext: (brandId: string) => brandContext(core, brandId),
  vocabulary: { collections: [], verticals: [], categories: ['Beauty', 'Apparel'] },
});

let brandId: string;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'sc-pdrafts-'));
  core = createCore(home);
  generated = [];
  analyzed = [];
  failNext = null;
  analyzerOn = true;
  brandId = core.store.createBrand({ specVersion: '0.1', meta: { name: 'Acme' } } as any).id;
});
afterEach(() => {
  resetPresenterDrafts();
  resetAssetBuilds();
  core.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** Run one step and wait for it to land. */
async function step(draftId: string, view: 'portrait' | 'front' | 'three-quarter', adjustment?: string) {
  await generateView(deps(), draftId, view, { adjustment });
  for (let i = 0; i < 200 && runningDraftJobCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
  return getPresenterDraft(core, draftId)!;
}

const refsOf = (req: GenerateRequest) =>
  (req.referenceImages ?? []).map((p) =>
    p
      .split('/')
      .pop()!
      .replace(/\.png$/, ''),
  );
const view = (d: PresenterDraftRecord, v: 'portrait' | 'front' | 'three-quarter') => d.views[v];

async function synthetic(direction = 'confident woman in her 40s, short silver hair') {
  return createPresenterDraft(deps(), { brandId, source: 'synthetic', direction });
}

/** A fully approved synthetic draft, ready to save. */
async function cast() {
  let d = await synthetic();
  d = await step(d.id, 'portrait');
  await approveView(deps(), d.id, 'portrait');
  d = await step(d.id, 'front');
  await approveView(deps(), d.id, 'front');
  d = await step(d.id, 'three-quarter');
  await approveView(deps(), d.id, 'three-quarter');
  return getPresenterDraft(core, d.id)!;
}

describe('from scratch: the identity is one person, rolled and then locked', () => {
  it('rolls the portrait from the description alone, and a second roll is a new person', async () => {
    let d = await synthetic();
    expect(d.source).toBe('synthetic');
    expect(view(d, 'portrait').status).toBe('empty');
    d = await step(d.id, 'portrait');
    expect(view(d, 'portrait').status).toBe('candidate');
    const first = view(d, 'portrait').hash!;
    expect(refsOf(generated[0])).toEqual([]);
    expect(generated[0].prompt).toContain('confident woman in her 40s, short silver hair');
    expect(generated[0].prompt).toMatch(/original person/);
    d = await step(d.id, 'portrait');
    expect(refsOf(generated[1])).toEqual([]);
    expect(view(d, 'portrait').hash).not.toBe(first);
    expect(view(d, 'portrait').rejected).toEqual([first]);
    expect(view(d, 'portrait').attempts).toBe(2);
    expect(d.generations).toBe(2);
  });

  it('an adjustment before the lock keeps the person: the candidate rides as the reference', async () => {
    let d = await synthetic();
    d = await step(d.id, 'portrait');
    const candidate = view(d, 'portrait').hash!;
    d = await step(d.id, 'portrait', 'slightly shorter hair');
    expect(refsOf(generated[1])).toEqual([candidate]);
    expect(generated[1].prompt).toContain('the same person as the attached image');
    expect(generated[1].prompt).toContain('slightly shorter hair');
    expect(view(d, 'portrait').conditionedOn).toEqual([candidate]);
  });

  it('once approved, the portrait is what the next view is drawn from, and the record is read off it', async () => {
    let d = await synthetic();
    d = await step(d.id, 'portrait');
    const portrait = view(d, 'portrait').hash!;
    await approveView(deps(), d.id, 'portrait');
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'portrait').status).toBe('approved');
    d = await step(d.id, 'front');
    expect(refsOf(generated[1])).toEqual([portrait]);
    expect(generated[1].referenceRoles).toEqual(['character']);
    expect(generated[1].prompt).toContain(CAPTURE_UNIFORM);
    expect(generated[1].prompt).toContain('full-length head-to-toe framing');
    // the analyzer read the approved portrait, once, and its words name the person from here on
    expect(analyzed).toHaveLength(1);
    expect(analyzed[0].imagePaths.map((p: string) => p.split('/').pop())).toEqual([`${portrait}.png`]);
    expect(analyzed[0].instruction).toContain('confident woman');
    expect(d.analysis?.promptName).toBe('a woman in her forties with a short silver crop');
    expect(generated[1].prompt).toContain('a woman in her forties with a short silver crop');
    expect(view(d, 'front').conditionedOn).toEqual([portrait]);
  });

  it('refuses a view whose dependencies are not approved, and a second job while one runs', async () => {
    const d = await synthetic();
    await expect(generateView(deps(), d.id, 'front', {})).rejects.toThrow(/face/);
    await expect(generateView(deps(), d.id, 'three-quarter', {})).rejects.toThrow(/face/);
    await generateView(deps(), d.id, 'portrait', {});
    await expect(generateView(deps(), d.id, 'portrait', {})).rejects.toMatchObject({ statusCode: 409 });
    for (let i = 0; i < 200 && runningDraftJobCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
  });

  it('refuses an empty description', async () => {
    await expect(
      createPresenterDraft(deps(), { brandId, source: 'synthetic', direction: '   ' }),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('regenerating a step never moves an approved one', () => {
  it('a new front leaves the portrait byte-identical and retires the old front', async () => {
    let d = await synthetic();
    d = await step(d.id, 'portrait');
    await approveView(deps(), d.id, 'portrait');
    d = await step(d.id, 'front');
    const portrait = view(d, 'portrait').hash!;
    const firstFront = view(d, 'front').hash!;
    d = await step(d.id, 'front');
    expect(view(d, 'portrait').hash).toBe(portrait);
    expect(view(d, 'portrait').status).toBe('approved');
    expect(view(d, 'front').hash).not.toBe(firstFront);
    expect(view(d, 'front').rejected).toEqual([firstFront]);
    // and the redraw was conditioned on the approved portrait, never on the rejected front
    expect(refsOf(generated[2])).toEqual([portrait]);
  });

  it('the three-quarter is drawn from both approved views and nothing that was rejected', async () => {
    let d = await synthetic();
    d = await step(d.id, 'portrait');
    await approveView(deps(), d.id, 'portrait');
    d = await step(d.id, 'front');
    const rejectedFront = view(d, 'front').hash!;
    d = await step(d.id, 'front');
    await approveView(deps(), d.id, 'front');
    d = await step(d.id, 'three-quarter');
    const refs = refsOf(generated[3]);
    expect(refs).toEqual([view(d, 'portrait').hash, view(d, 'front').hash]);
    expect(refs).not.toContain(rejectedFront);
    expect(generated[3].prompt).toMatch(/about 40 degrees/);
  });
});

describe('redoing an upstream view', () => {
  it('stales everything built on it, and save refuses until they are redone', async () => {
    let d = await cast();
    await redoView(deps(), d.id, 'portrait');
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'portrait').status).toBe('empty');
    expect(view(d, 'front').status).toBe('stale');
    expect(view(d, 'three-quarter').status).toBe('stale');
    // the identity is being re-rolled: the words read off the old face go too
    expect(d.analysis).toBeUndefined();
    await updatePresenterDraft(core, d.id, { name: 'Ilse' });
    await expect(savePresenterDraft(deps(), d.id)).rejects.toThrow(/face/i);
    d = await step(d.id, 'portrait');
    await approveView(deps(), d.id, 'portrait');
    await expect(savePresenterDraft(deps(), d.id)).rejects.toThrow(/full body|front/i);
    d = await step(d.id, 'front');
    await approveView(deps(), d.id, 'front');
    d = await step(d.id, 'three-quarter');
    await approveView(deps(), d.id, 'three-quarter');
    const saved = await savePresenterDraft(deps(), d.id);
    expect(saved.presenter.id).toMatch(/^up-[a-f0-9]{8}$/);
  });

  it('redoing the front stales only the three-quarter', async () => {
    let d = await cast();
    await redoView(deps(), d.id, 'front');
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'portrait').status).toBe('approved');
    expect(view(d, 'front').status).toBe('empty');
    expect(view(d, 'three-quarter').status).toBe('stale');
    expect(d.analysis).toBeDefined();
  });

  it('name, categories and direction never stale anything', async () => {
    let d = await cast();
    await updatePresenterDraft(core, d.id, { name: 'Ilse', facets: ['Beauty'], direction: 'something else' });
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'front').status).toBe('approved');
    expect(view(d, 'three-quarter').status).toBe('approved');
    expect(d.name).toBe('Ilse');
    expect(d.facets).toEqual(['Beauty']);
  });
});

describe('a failure keeps the approved work', () => {
  it('leaves the approved portrait and reports the error on the step that failed', async () => {
    let d = await synthetic();
    d = await step(d.id, 'portrait');
    await approveView(deps(), d.id, 'portrait');
    const portrait = view(d, 'portrait').hash!;
    failNext = new Error('the engine fell over');
    d = await step(d.id, 'front');
    expect(view(d, 'front').status).toBe('empty');
    expect(view(d, 'front').error).toMatch(/fell over/);
    expect(view(d, 'front').attempts).toBe(1);
    expect(view(d, 'portrait').hash).toBe(portrait);
    expect(view(d, 'portrait').status).toBe('approved');
    expect(d.activeView).toBeNull();
    // and the next try clears the error
    d = await step(d.id, 'front');
    expect(view(d, 'front').status).toBe('candidate');
    expect(view(d, 'front').error).toBeUndefined();
  });

  it('a candidate that was there before a failed retry stays', async () => {
    let d = await synthetic();
    d = await step(d.id, 'portrait');
    const candidate = view(d, 'portrait').hash!;
    failNext = new Error('quota');
    d = await step(d.id, 'portrait');
    expect(view(d, 'portrait').status).toBe('candidate');
    expect(view(d, 'portrait').hash).toBe(candidate);
    expect(view(d, 'portrait').error).toMatch(/quota/);
  });

  it('a restart sweeps a slot left generating back to what it was, and says why', async () => {
    let d = await synthetic();
    d = await step(d.id, 'portrait');
    // fake the crash: the row says generating, nothing is running
    const row = core.store.getPresenterDraft(d.id)!.json as any;
    row.views.portrait.status = 'generating';
    row.activeView = 'portrait';
    core.store.putPresenterDraft({ id: d.id, brandId, json: row });
    const swept = sweepPresenterDrafts(core);
    expect(swept).toBe(1);
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'portrait').status).toBe('candidate');
    expect(view(d, 'portrait').error).toMatch(/restart/);
    expect(d.activeView).toBeNull();
  });
});

describe('saving', () => {
  it('writes exactly the approved views, in order, with the portrait leading and the uniform nowhere', async () => {
    const d = await cast();
    await updatePresenterDraft(core, d.id, { name: 'Ilse', facets: ['Beauty'] });
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.origin).toBe('custom');
    expect(presenter.source).toBe('synthetic');
    expect(presenter.name).toBe('Ilse');
    expect(presenter.promptName).toBe('a woman in her forties with a short silver crop');
    expect(presenter.facial).toBe('square jaw, strong brow');
    expect(presenter.skin).toBe('fair with fine lines');
    expect(presenter.build).toBe('tall and slender');
    expect(presenter.suitableCategories).toEqual(['Beauty']);
    expect(presenter.likeness).toBeUndefined();
    expect(presenter.shots?.map((s) => s.angle)).toEqual(['portrait', 'front', 'three-quarter']);
    expect(presenter.shots?.map((s) => s.file)).toEqual([
      `asset:${d.views.portrait.hash}`,
      `asset:${d.views.front.hash}`,
      `asset:${d.views['three-quarter'].hash}`,
    ]);
    expect(presenter.sourceRefs).toBeUndefined();
    // the avatar is a crop of the approved portrait, the card is the portrait
    const want = await presenterCrops(core, d.views.portrait.hash, 'portrait');
    expect(presenter.avatar).toBe(`asset:${want.avatarHash}`);
    expect(presenter.preview).toBe(`asset:${d.views.portrait.hash}`);
    expect(JSON.stringify(presenter)).not.toContain('ribbed tank');
    // in the brand, the draft gone
    expect(brandCharacters(core.store.getBrand(brandId)!.json).map((c: any) => c.id)).toEqual([presenter.id]);
    expect(getPresenterDraft(core, d.id)).toBeNull();
  });

  it('refuses to save without a name, or with a step still running', async () => {
    const d = await cast();
    await expect(savePresenterDraft(deps(), d.id)).rejects.toThrow(/name/i);
  });

  it('removes what was rejected and keeps what was approved', async () => {
    let d = await synthetic();
    d = await step(d.id, 'portrait');
    const rejected = view(d, 'portrait').hash!;
    d = await step(d.id, 'portrait');
    await approveView(deps(), d.id, 'portrait');
    d = await step(d.id, 'front');
    await approveView(deps(), d.id, 'front');
    d = await step(d.id, 'three-quarter');
    await approveView(deps(), d.id, 'three-quarter');
    await updatePresenterDraft(core, d.id, { name: 'Ilse' });
    d = getPresenterDraft(core, d.id)!;
    const kept = [d.views.portrait.hash!, d.views.front.hash!, d.views['three-quarter'].hash!];
    await savePresenterDraft(deps(), d.id);
    expect(existsSync(core.images.pathFor(rejected))).toBe(false);
    for (const h of kept) expect(existsSync(core.images.pathFor(h))).toBe(true);
  });

  it('the saved person compiles like any other: three character references, the portrait essential', async () => {
    const d = await cast();
    await updatePresenterDraft(core, d.id, { name: 'Ilse' });
    const { presenter } = await savePresenterDraft(deps(), d.id);
    const brand = core.store.getBrand(brandId)!;
    const r = compileBrief(
      {
        tokens: [
          { t: 'text', v: 'portrait of ' },
          { t: 'character', id: presenter.id },
        ],
      },
      {
        brand: brand.json as any,
        images: core.images,
        engineCaps: {
          id: 'x',
          displayName: 'x',
          localOnly: false,
          supportsEdit: true,
          supportsMask: false,
          maxReferenceImages: 5,
        },
      },
    );
    const chars = r.attachments.filter((a) => a.role === 'character');
    expect(chars).toHaveLength(3);
    expect(chars[0].essential).toBe(true);
    expect(chars[0].hash).toBe(d.views.portrait.hash);
    expect(chars.map((a) => a.angle)).toEqual(['portrait', 'front', 'three-quarter']);
    expect(r.prompt).toContain('a woman in her forties with a short silver crop');
    expect(r.prompt).toContain('square jaw, strong brow');
    expect(r.warnings).toEqual([]);
  });
});

describe('with no engine that can draw', () => {
  it('a photos draft still saves: the portrait leads and the other photographs follow as they are', async () => {
    analyzerOn = false;
    const a = core.images.save(await png('#a08070', 800, 1000));
    const b = core.images.save(await png('#b09080', 800, 1000));
    const blind = { ...deps(), engine: null };
    let d = await createPresenterDraft(blind, { brandId, source: 'photos', imageHashes: [a, b], attestation: true });
    for (let i = 0; i < 200 && runningDraftJobCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'portrait')).toMatchObject({ status: 'approved', hash: a, origin: 'photo' });
    await updatePresenterDraft(core, d.id, { name: 'Noor' });
    const { presenter } = await savePresenterDraft(blind, d.id);
    expect(presenter.shots?.map((s) => s.file)).toEqual([`asset:${a}`, `asset:${b}`]);
    expect(presenter.shots?.[0].angle).toBe('portrait');
    expect(presenter.shots?.[1].angle).toBeUndefined();
    expect(presenter.sourceRefs?.map((s) => s.file)).toEqual([`asset:${a}`, `asset:${b}`]);
    expect(presenter.avatar).toMatch(/^asset:/);
    expect(presenter.preview).toMatch(/^asset:/);
  });

  it('a person from a description cannot be started', async () => {
    const blind = { ...deps(), engine: null };
    await expect(
      createPresenterDraft(blind, { brandId, source: 'synthetic', direction: 'someone' }),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('discarding', () => {
  it('removes generated pictures nothing else holds, and never a photo another draft shares', async () => {
    const photo = core.images.save(await png('#a08070', 800, 1000));
    const other = await createPresenterDraft(deps(), {
      brandId,
      source: 'photos',
      imageHashes: [photo],
      attestation: true,
    });
    let d = await createPresenterDraft(deps(), { brandId, source: 'photos', imageHashes: [photo], attestation: true });
    for (let i = 0; i < 200 && runningDraftJobCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    d = await step(d.id, 'front');
    const front = view(d, 'front').hash!;
    await discardPresenterDraft(deps(), d.id);
    expect(getPresenterDraft(core, d.id)).toBeNull();
    expect(existsSync(core.images.pathFor(front))).toBe(false);
    // the photo is the other draft's too
    expect(existsSync(core.images.pathFor(photo))).toBe(true);
    expect(getPresenterDraft(core, other.id)).not.toBeNull();
  });

  it('removes a photo nobody else holds', async () => {
    const photo = core.images.save(await png('#a08070', 800, 1000));
    const d = await createPresenterDraft(deps(), {
      brandId,
      source: 'photos',
      imageHashes: [photo],
      attestation: true,
    });
    for (let i = 0; i < 200 && runningDraftJobCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    await discardPresenterDraft(deps(), d.id);
    expect(existsSync(core.images.pathFor(photo))).toBe(false);
  });
});

describe('from photos: the originals are the truth', () => {
  async function photos(n: number) {
    const out: string[] = [];
    for (let i = 0; i < n; i++)
      out.push(core.images.save(await png(`#${(0x60 + i * 0x10).toString(16)}7080`, 800, 1000)));
    return out;
  }
  async function settled(id: string) {
    for (let i = 0; i < 200 && runningDraftJobCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    return getPresenterDraft(core, id)!;
  }

  it('needs the likeness confirmation and at least one photo', async () => {
    const [p] = await photos(1);
    await expect(createPresenterDraft(deps(), { brandId, source: 'photos', imageHashes: [p] })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      createPresenterDraft(deps(), { brandId, source: 'photos', imageHashes: [], attestation: true }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('files the photos by view: a usable portrait fills its slot as the original, pre-approved', async () => {
    const [portrait, snap] = await photos(2);
    let d = await createPresenterDraft(deps(), {
      brandId,
      source: 'photos',
      imageHashes: [portrait, snap],
      attestation: true,
    });
    d = await settled(d.id);
    expect(analyzed[0].classifyPhotos).toBe(true);
    expect(d.sources).toEqual([portrait, snap]);
    expect(view(d, 'portrait')).toMatchObject({ status: 'approved', hash: portrait, origin: 'photo' });
    expect(view(d, 'front').status).toBe('empty');
    expect(d.attestation?.version).toBe('v1');
    // the front is drawn from the approved portrait first, then the other photos, inside the cap
    d = await step(d.id, 'front');
    expect(refsOf(generated[0])).toEqual([portrait, snap]);
    expect(generated[0].referenceRoles).toEqual(['character', 'character']);
  });

  it('one photo is enough: with nothing to read it, the photo is the portrait', async () => {
    analyzerOn = false;
    const [p] = await photos(1);
    let d = await createPresenterDraft(deps(), { brandId, source: 'photos', imageHashes: [p], attestation: true });
    d = await settled(d.id);
    expect(view(d, 'portrait')).toMatchObject({ status: 'approved', hash: p, origin: 'photo' });
  });

  it('four photos stay one person: one record, the originals kept, the confirmation recorded', async () => {
    const four = await photos(4);
    let d = await createPresenterDraft(deps(), { brandId, source: 'photos', imageHashes: four, attestation: true });
    d = await settled(d.id);
    d = await step(d.id, 'front');
    await approveView(deps(), d.id, 'front');
    d = await step(d.id, 'three-quarter');
    await approveView(deps(), d.id, 'three-quarter');
    await updatePresenterDraft(core, d.id, { name: 'Noor' });
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.source).toBe('photos');
    expect(presenter.likeness?.version).toBe('v1');
    expect(presenter.sourceRefs?.map((s) => s.file)).toEqual(four.map((h) => `asset:${h}`));
    expect(presenter.shots?.[0]).toMatchObject({ file: `asset:${four[0]}`, angle: 'portrait' });
    expect(presenter.promptName).toBe('a woman in her forties with a short silver crop');
    // one analysis, over the photographs, not one per view
    expect(analyzed).toHaveLength(1);
    // the originals survive the save; a user photo is never removed
    for (const h of four) expect(existsSync(core.images.pathFor(h))).toBe(true);
    expect(brandCharacters(core.store.getBrand(brandId)!.json)).toHaveLength(1);
  });

  it('a photo can be put in a slot by hand; changing the portrait stales what was drawn, never a photo', async () => {
    analyzerOn = false;
    const [a, b] = await photos(2);
    let d = await createPresenterDraft(deps(), { brandId, source: 'photos', imageHashes: [a, b], attestation: true });
    d = await settled(d.id);
    await usePhotoForView(deps(), d.id, 'front', b);
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'front')).toMatchObject({ status: 'approved', hash: b, origin: 'photo' });
    d = await step(d.id, 'three-quarter');
    await approveView(deps(), d.id, 'three-quarter');
    await usePhotoForView(deps(), d.id, 'portrait', b);
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'portrait').hash).toBe(b);
    // the photograph stands whatever changed upstream; the drawn view does not
    expect(view(d, 'front').status).toBe('approved');
    expect(view(d, 'three-quarter').status).toBe('stale');
    await expect(usePhotoForView(deps(), d.id, 'front', 'f'.repeat(32))).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('the three-view contract', () => {
  it('is face, full body, three-quarter, each drawn from the approved views before it', () => {
    expect(PRESENTER_VIEWS).toEqual(['portrait', 'front', 'three-quarter']);
    expect(DEPENDS.portrait).toEqual([]);
    expect(DEPENDS.front).toEqual(['portrait']);
    expect(DEPENDS['three-quarter']).toEqual(['portrait', 'front']);
  });

  it('planStep attaches approved views first, then the photographs, inside the cap', () => {
    const empty = { status: 'empty' as const, attempts: 0, rejected: [] };
    const rec = {
      source: 'photos' as const,
      direction: '',
      name: 'Ilse',
      analysis: { promptName: 'a woman' },
      sources: ['s1', 's2', 's3'],
      views: {
        portrait: { ...empty, status: 'approved' as const, hash: 'p' },
        front: { ...empty, status: 'approved' as const, hash: 'f' },
        'three-quarter': empty,
      },
    } as unknown as PresenterDraftRecord;
    const tq = planStep(rec, 'three-quarter', undefined, 5);
    expect(tq.refs).toEqual(['p', 'f', 's1', 's2', 's3']);
    expect(tq.prompt).toMatch(/about 40 degrees/);
    expect(planStep(rec, 'three-quarter', undefined, 3).refs).toEqual(['p', 'f', 's1']);
    const synth = planStep(
      { ...rec, source: 'synthetic', direction: 'a woman in her 30s', views: { ...rec.views, portrait: empty } },
      'portrait',
      undefined,
      5,
    );
    expect(synth.refs).toEqual([]);
    expect(synth.prompt).toContain('a woman in her 30s');
  });
});

describe('revising an approved view', () => {
  it('keeps the approved picture until the decision, and Use stales what was drawn from it', async () => {
    let d = await cast();
    const face = view(d, 'portrait').hash!;
    const front = view(d, 'front').hash!;
    d = await step(d.id, 'portrait', 'shorter hair');
    // the revision rides as a candidate; the approved face is still on the row and on disk
    expect(view(d, 'portrait')).toMatchObject({ status: 'candidate', prior: face, adjustment: 'shorter hair' });
    expect(view(d, 'portrait').hash).not.toBe(face);
    expect(existsSync(core.images.pathFor(face))).toBe(true);
    // conditioned on the approved face, so a nudge keeps the person
    expect(refsOf(generated.at(-1)!)).toEqual([face]);
    expect(view(d, 'front').status).toBe('approved');
    await approveView(deps(), d.id, 'portrait');
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'portrait').status).toBe('approved');
    expect(view(d, 'portrait').prior).toBeUndefined();
    expect(view(d, 'portrait').rejected).toContain(face);
    expect(view(d, 'front').status).toBe('stale');
    expect(view(d, 'three-quarter').status).toBe('stale');
    expect(view(d, 'front').hash).toBe(front);
    // a stale view is drawn again from the new face, and the old front retires
    d = await step(d.id, 'front');
    expect(refsOf(generated.at(-1)!)).toEqual([view(d, 'portrait').hash]);
    expect(view(d, 'front').status).toBe('candidate');
    expect(view(d, 'front').rejected).toContain(front);
  });

  it('Keep previous puts the approved picture back and nothing else moves', async () => {
    let d = await cast();
    const face = view(d, 'portrait').hash!;
    d = await step(d.id, 'portrait', 'shorter hair');
    const revision = view(d, 'portrait').hash!;
    await expect(revertView(deps(), d.id, 'front')).rejects.toMatchObject({ statusCode: 400 });
    await revertView(deps(), d.id, 'portrait');
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'portrait')).toMatchObject({ status: 'approved', hash: face, origin: 'generated' });
    expect(view(d, 'portrait').prior).toBeUndefined();
    expect(view(d, 'portrait').rejected).toContain(revision);
    expect(view(d, 'front').status).toBe('approved');
    expect(view(d, 'three-quarter').status).toBe('approved');
    // a second revision before deciding lets the first candidate go and keeps the same prior
    d = await step(d.id, 'front', 'arms relaxed');
    const first = view(d, 'front').hash!;
    d = await step(d.id, 'front', 'arms relaxed, feet apart');
    expect(view(d, 'front').prior).toBe(d.views.front.prior);
    expect(view(d, 'front').rejected).toContain(first);
    await updatePresenterDraft(core, d.id, { name: 'Ilse' });
    await expect(savePresenterDraft(deps(), d.id)).rejects.toThrow(/full body/);
  });

  it('a failed revision leaves the approved picture exactly where it was', async () => {
    let d = await cast();
    const face = view(d, 'portrait').hash!;
    failNext = new Error('the engine timed out');
    d = await step(d.id, 'portrait', 'shorter hair');
    expect(view(d, 'portrait')).toMatchObject({ status: 'approved', hash: face, error: 'the engine timed out' });
    expect(view(d, 'portrait').prior).toBeUndefined();
    expect(view(d, 'front').status).toBe('approved');
  });
});

describe('abandoned drafts', () => {
  it('are let go of after two weeks, pictures included, and a fresh one is left alone', async () => {
    let old = await synthetic();
    old = await step(old.id, 'portrait');
    const candidate = view(old, 'portrait').hash!;
    const fresh = await synthetic();
    const later = Date.now() + ABANDONED_DRAFT_MS + 60_000;
    expect(sweepAbandonedPresenterDrafts(core, {}, Date.now())).toBe(0);
    expect(sweepAbandonedPresenterDrafts(core, {}, later)).toBe(2);
    expect(getPresenterDraft(core, old.id)).toBeNull();
    expect(getPresenterDraft(core, fresh.id)).toBeNull();
    expect(existsSync(core.images.pathFor(candidate))).toBe(false);
  });

  it('never touch a draft that is mid-step, or a photo another draft shares', async () => {
    const photo = core.images.save(await png('#a08070', 800, 1000));
    const a = await createPresenterDraft(deps(), {
      brandId,
      source: 'photos',
      imageHashes: [photo],
      attestation: true,
    });
    const b = await createPresenterDraft(deps(), {
      brandId,
      source: 'photos',
      imageHashes: [photo],
      attestation: true,
    });
    for (let i = 0; i < 200 && runningDraftJobCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    const later = Date.now() + ABANDONED_DRAFT_MS + 60_000;
    // b is drawing: it stays, and the photo it holds stays with it
    await generateView(deps(), b.id, 'front', {});
    expect(sweepAbandonedPresenterDrafts(core, {}, later)).toBe(1);
    expect(getPresenterDraft(core, a.id)).toBeNull();
    expect(getPresenterDraft(core, b.id)).not.toBeNull();
    expect(existsSync(core.images.pathFor(photo))).toBe(true);
    for (let i = 0; i < 200 && runningDraftJobCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
  });
});
