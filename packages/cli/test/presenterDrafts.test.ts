import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter, type GenerateRequest } from '@scenri/core';
import { commit, customPresenterHeads, headOf, presenterChain, type CustomPresenter } from '../src/assetRecords.js';
import { compileBrief } from '../src/brief.js';
import { brandCharacters, presenterCrops, resetAssetBuilds, type AssetBuildDeps } from '../src/customAssets.js';
import {
  CAPTURE_UNIFORM,
  CORE_VIEWS,
  EXTRA_VIEWS,
  PRESENTER_VIEWS,
  type PresenterView,
} from '../src/presenterPrompts.js';
import {
  ABANDONED_DRAFT_MS,
  DEPENDS,
  approveView,
  createPresenterDraft,
  discardPresenterDraft,
  generateView,
  getPresenterDraft,
  mergeIdentityEdits,
  openPresenterEdit,
  planStep,
  redoView,
  resetPresenterDrafts,
  restoreView,
  stopPresenterDraft,
  revertView,
  runningDraftJobCount,
  savePresenterDraft,
  seedDraftFromPresenter,
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
/** When set, the next draw waits here until released or aborted. */
let holdNext: { release?: () => void } | null = null;
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
  generate: async (req, signal) => {
    generated.push(req);
    if (holdNext) {
      const h = holdNext;
      holdNext = null;
      await new Promise<void>((resolve, reject) => {
        h.release = resolve;
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
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
async function step(draftId: string, view: PresenterView, adjustment?: string, decide?: 'auto') {
  await generateView(deps(), draftId, view, { adjustment, decide });
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
const view = (d: PresenterDraftRecord, v: PresenterView) => d.views[v];

async function synthetic(direction = 'confident woman in her 40s, short silver hair') {
  return createPresenterDraft(deps(), { brandId, source: 'synthetic', direction });
}

/** Draw and approve each view in turn. */
async function build(draftId: string, views: readonly PresenterView[]) {
  for (const v of views) {
    await step(draftId, v);
    await approveView(deps(), draftId, v);
  }
  return getPresenterDraft(core, draftId)!;
}

/** A synthetic draft with the three core views approved, ready to save. */
async function cast() {
  const d = await synthetic();
  return build(d.id, CORE_VIEWS);
}

/** The same, with the extras switched on and all six views approved. */
async function castWithExtras() {
  const d = await synthetic();
  await updatePresenterDraft(core, d.id, { extras: true });
  return build(d.id, PRESENTER_VIEWS);
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
    expect(generated[3].prompt).toMatch(/about forty-five degrees/);
  });
});

describe('redoing an upstream view', () => {
  it('stales everything built on it, and save refuses until they are redone', async () => {
    let d = await castWithExtras();
    await redoView(deps(), d.id, 'portrait');
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'portrait').status).toBe('empty');
    // Nothing downstream has moved yet: what those views were drawn from is
    // still the picture standing here, kept until another one is used.
    for (const v of PRESENTER_VIEWS) if (v !== 'portrait') expect(view(d, v).status).toBe('approved');
    // the identity is being re-rolled: the words read off the old face go too
    expect(d.analysis).toBeUndefined();
    await updatePresenterDraft(core, d.id, { name: 'Ilse' });
    await expect(savePresenterDraft(deps(), d.id)).rejects.toThrow(/face/i);
    d = await step(d.id, 'portrait');
    await approveView(deps(), d.id, 'portrait');
    // used, and now everything built on the old face is out of date
    d = getPresenterDraft(core, d.id)!;
    for (const v of PRESENTER_VIEWS) if (v !== 'portrait') expect(view(d, v).status).toBe('stale');
    await expect(savePresenterDraft(deps(), d.id)).rejects.toThrow(/full body|front/i);
    d = await build(d.id, ['front', 'three-quarter']);
    // the extras were built on the old face too, and a stale extra blocks the save
    await expect(savePresenterDraft(deps(), d.id)).rejects.toThrow(/redo the back view/);
    d = await build(d.id, EXTRA_VIEWS);
    const saved = await savePresenterDraft(deps(), d.id);
    expect(saved.presenter.id).toMatch(/^up-[a-f0-9]{8}$/);
  });

  it('redoing the front stales the turned views and leaves the face', async () => {
    let d = await castWithExtras();
    await redoView(deps(), d.id, 'front');
    await step(d.id, 'front');
    await approveView(deps(), d.id, 'front');
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'portrait').status).toBe('approved');
    expect(view(d, 'front').status).toBe('approved');
    expect(view(d, 'three-quarter').status).toBe('stale');
    expect(view(d, 'back').status).toBe('stale');
    expect(view(d, 'left').status).toBe('stale');
    expect(view(d, 'right').status).toBe('stale');
    expect(d.analysis).toBeDefined();
  });

  it('redoing the left stales only the right, which is drawn from it', async () => {
    let d = await castWithExtras();
    await redoView(deps(), d.id, 'left');
    await step(d.id, 'left');
    await approveView(deps(), d.id, 'left');
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'left').status).toBe('approved');
    expect(view(d, 'right').status).toBe('stale');
    for (const v of ['portrait', 'front', 'three-quarter', 'back'] as const) expect(view(d, v).status).toBe('approved');
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

  it('carries what stays the same from the first answer to the record', async () => {
    const made = await createPresenterDraft(deps(), {
      brandId,
      source: 'synthetic',
      direction: 'a woman in her 30s',
      keep: 'thin black glasses and a scar through her left eyebrow',
    });
    expect(made.keep).toBe('thin black glasses and a scar through her left eyebrow');
    // it can be added later, and cleared
    const more = await updatePresenterDraft(core, made.id, { keep: 'a floral tattoo on her right forearm' });
    expect(more.keep).toBe('a floral tattoo on her right forearm');
    expect((await updatePresenterDraft(core, made.id, { keep: '' })).keep).toBeUndefined();
  });

  it('keeps what the person said stays the same, ahead of what the analyzer read', async () => {
    const d = await cast();
    await updatePresenterDraft(core, d.id, {
      name: 'Ilse',
      keep: 'a floral tattoo on her right forearm',
    });
    const { presenter } = await savePresenterDraft(deps(), d.id);
    // their own words lead, because a cap eats whatever goes second
    expect(presenter.identityNotes?.startsWith('a floral tattoo on her right forearm.')).toBe(true);
    // and the read of the approved face is still there, after them
    expect(presenter.identityNotes).toContain('the strong brow and the silver crop');
  });

  it('leaves the notes to the analyzer when nothing was said to keep', async () => {
    const d = await cast();
    await updatePresenterDraft(core, d.id, { name: 'Ilse' });
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.identityNotes).toBe('the strong brow and the silver crop must survive every generation');
  });

  it('refuses to save without a name, or with a step still running', async () => {
    const d = await cast();
    await expect(savePresenterDraft(deps(), d.id)).rejects.toThrow(/name/i);
  });

  it('removes what was rejected and keeps what was approved', async () => {
    let d = await synthetic();
    d = await step(d.id, 'portrait');
    const rejected = view(d, 'portrait').hash!;
    d = await build(d.id, ['portrait', 'front', 'three-quarter']);
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

  it('a read that fails says why and files the first photo as the face, the way no analyzer does', async () => {
    const [a, b] = await photos(2);
    const broken: AssetBuildDeps = {
      ...deps(),
      analyzer: {
        isAvailable: async () => ({ ok: true }),
        analyze: async () => {
          throw new Error('Your Codex plan usage limit is used up until 11:17 PM.');
        },
      } as any,
    };
    const created = await createPresenterDraft(broken, {
      brandId,
      source: 'photos',
      imageHashes: [a, b],
      attestation: true,
    });
    const d = await settled(created.id);
    expect(d.stage).toBe('idle');
    expect(d.activeView).toBeNull();
    expect(d.readError).toContain('usage limit');
    expect(d.analysis).toBeUndefined();
    expect(d.views.portrait).toMatchObject({ status: 'approved', origin: 'photo', hash: a });
    expect(d.views.front.status).toBe('empty');
    // the row remembers it across a reload
    expect(getPresenterDraft(core, created.id)?.readError).toContain('usage limit');
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
    d = await build(d.id, ['front', 'three-quarter']);
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

describe('the view contract: three core, three on request', () => {
  it('builds face, full body, three-quarter by default; back, left, right on request; each from the approved views before it', () => {
    expect(CORE_VIEWS).toEqual(['portrait', 'front', 'three-quarter']);
    expect(EXTRA_VIEWS).toEqual(['back', 'left', 'right']);
    expect(PRESENTER_VIEWS).toEqual(['portrait', 'front', 'three-quarter', 'back', 'left', 'right']);
    expect(DEPENDS.portrait).toEqual([]);
    expect(DEPENDS.front).toEqual(['portrait']);
    expect(DEPENDS['three-quarter']).toEqual(['portrait', 'front']);
    expect(DEPENDS.back).toEqual(['portrait', 'front']);
    expect(DEPENDS.left).toEqual(['portrait', 'front']);
    expect(DEPENDS.right).toEqual(['portrait', 'front', 'left']);
  });

  it('planStep rides the pictures of a detail after the person, with their own role, in whatever room the budget leaves', () => {
    const empty = { status: 'empty' as const, attempts: 0, rejected: [] };
    const rec = {
      source: 'synthetic' as const,
      direction: 'a woman in her 30s',
      keep: 'thin black rectangular metal frames',
      detailRefs: { glasses: ['g1', 'g2'], tattoo: ['t1'] },
      name: 'Noa',
      analysis: { promptName: 'a woman' },
      sources: [],
      views: {
        portrait: { ...empty, status: 'approved' as const, hash: 'p' },
        front: { ...empty, status: 'approved' as const, hash: 'f' },
        'three-quarter': empty,
        back: empty,
        left: empty,
        right: empty,
      },
    } as unknown as PresenterDraftRecord;
    // the face roll: nothing of a person to attach, so the details ride alone
    const face = planStep({ ...rec, views: { ...rec.views, portrait: empty } }, 'portrait', undefined, 5);
    expect(face.refs).toEqual(['g1', 'g2', 't1']);
    expect(face.roles).toEqual(['detail', 'detail', 'detail']);
    // a later view: the person first as the person, then the details as details
    const tq = planStep(rec, 'three-quarter', undefined, 5);
    expect(tq.refs).toEqual(['p', 'f', 'g1', 'g2', 't1']);
    expect(tq.roles).toEqual(['character', 'character', 'detail', 'detail', 'detail']);
    // a tight budget keeps the person and drops details, never the other way round
    const tight = planStep(rec, 'three-quarter', undefined, 3);
    expect(tight.refs).toEqual(['p', 'f', 'g1']);
    expect(tight.roles).toEqual(['character', 'character', 'detail']);
    // with nothing attached, every reference is the person
    const plain = planStep({ ...rec, detailRefs: undefined }, 'three-quarter', undefined, 5);
    expect(plain.roles).toEqual(['character', 'character']);
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
        back: empty,
        left: { ...empty, status: 'approved' as const, hash: 'l' },
        right: empty,
      },
    } as unknown as PresenterDraftRecord;
    const tq = planStep(rec, 'three-quarter', undefined, 5);
    expect(tq.refs).toEqual(['p', 'f', 's1', 's2', 's3']);
    expect(tq.prompt).toMatch(/about forty-five degrees/);
    expect(planStep(rec, 'three-quarter', undefined, 3).refs).toEqual(['p', 'f', 's1']);
    // an extra is conditioned exactly as its DEPENDS say: the right rides on the approved left
    expect(planStep(rec, 'back', undefined, 5).refs).toEqual(['p', 'f', 's1', 's2', 's3']);
    expect(planStep(rec, 'right', undefined, 5).refs).toEqual(['p', 'f', 'l', 's1', 's2']);
    expect(planStep(rec, 'right', undefined, 5).prompt).toMatch(/right side faces the camera/);
    const synth = planStep(
      { ...rec, source: 'synthetic', direction: 'a woman in her 30s', views: { ...rec.views, portrait: empty } },
      'portrait',
      undefined,
      5,
    );
    expect(synth.refs).toEqual([]);
    expect(synth.prompt).toContain('a woman in her 30s');
  });

  it('carries what stays the same about them into every view that can show it', () => {
    const empty = { status: 'empty' as const, attempts: 0, rejected: [] };
    const rec = {
      source: 'photos' as const,
      direction: '',
      name: 'Ilse',
      keep: 'a floral tattoo on her right forearm',
      analysis: { promptName: 'a woman' },
      sources: ['s1'],
      identityEdits: [],
      views: {
        portrait: { ...empty, status: 'approved' as const, hash: 'p' },
        front: { ...empty, status: 'approved' as const, hash: 'f' },
        'three-quarter': empty,
        back: empty,
        left: { ...empty, status: 'approved' as const, hash: 'l' },
        right: empty,
      },
    } as unknown as PresenterDraftRecord;
    // their own words, verbatim, side and all: a normalised side is a wrong side
    for (const v of ['front', 'three-quarter', 'back', 'left', 'right'] as const) {
      expect(planStep(rec, v, undefined, 5).prompt).toContain('a floral tattoo on her right forearm');
    }
    // a forearm cannot be drawn in a frame that stops at the collarbone
    const face = { ...rec, keep: 'thin black glasses' } as PresenterDraftRecord;
    expect(planStep(face, 'front', undefined, 5).prompt).toContain('thin black glasses');
    expect(planStep(face, 'back', undefined, 5).prompt).not.toContain('thin black glasses');

    // a side named is a side kept: the right view stops being drawn from the left one
    expect(planStep(rec, 'right', undefined, 5).refs).toEqual(['p', 'f', 's1']);
    const noSide = { ...rec, keep: 'a septum piercing' } as PresenterDraftRecord;
    expect(planStep(noSide, 'right', undefined, 5).refs).toEqual(['p', 'f', 'l', 's1']);

    // and with no analyzer and no edits, the words still ride
    const bare = { ...rec, analysis: undefined } as PresenterDraftRecord;
    expect(planStep(bare, 'front', undefined, 5).prompt).toContain('a floral tattoo on her right forearm');

    // the face is rolled from the description and what stays, together
    const synth = planStep(
      {
        ...rec,
        source: 'synthetic',
        direction: 'a woman in her 30s',
        keep: 'thin black glasses',
        views: { ...rec.views, portrait: empty },
      } as PresenterDraftRecord,
      'portrait',
      undefined,
      5,
    );
    expect(synth.prompt).toContain('a woman in her 30s, thin black glasses');
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
    await expect(savePresenterDraft(deps(), d.id)).rejects.toThrow(/front view/);
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

describe('a described person needs the description that describes them', () => {
  // The patch route takes a cleared direction and nothing revalidated it, so
  // the roll went out as "an adult, : an original person ...", a sentence with
  // a hole where the person should be. The draw refuses it in the same words
  // creation would have.
  it('refuses to draw a synthetic draft whose direction was cleared', async () => {
    const d = await synthetic();
    await updatePresenterDraft(core, d.id, { direction: '' });
    await expect(generateView(deps(), d.id, 'portrait', {})).rejects.toMatchObject({
      statusCode: 400,
      message: 'describe who they are in a sentence',
    });
    await expect(generateView(deps(), d.id, 'front', {})).rejects.toThrow(/describe who they are/);
  });

  it('draws again the moment a description is back', async () => {
    const d = await synthetic();
    await updatePresenterDraft(core, d.id, { direction: '   ' });
    await expect(generateView(deps(), d.id, 'portrait', {})).rejects.toThrow(/describe who they are/);
    await updatePresenterDraft(core, d.id, { direction: 'a woman in their 40s' });
    const back = await step(d.id, 'portrait');
    expect(view(back, 'portrait').status).toBe('candidate');
  });
});

describe('extras are built on request', () => {
  it('refuses an extra until the extras are switched on, and draws it from the approved core views after', async () => {
    let d = await cast();
    expect(d.extras).toBe(false);
    await expect(generateView(deps(), d.id, 'back', {})).rejects.toMatchObject({
      statusCode: 400,
      message: 'extra views are built on request',
    });
    await expect(generateView(deps(), d.id, 'left', {})).rejects.toThrow(/on request/);
    await expect(generateView(deps(), d.id, 'right', {})).rejects.toThrow(/on request/);
    d = await updatePresenterDraft(core, d.id, { extras: true });
    expect(d.extras).toBe(true);
    d = await step(d.id, 'back');
    expect(view(d, 'back').status).toBe('candidate');
    expect(refsOf(generated.at(-1)!)).toEqual([view(d, 'portrait').hash, view(d, 'front').hash]);
    expect(generated.at(-1)!.prompt).toMatch(/directly away from the camera/);
    // the right waits on the left, exactly as its DEPENDS say
    await expect(generateView(deps(), d.id, 'right', {})).rejects.toThrow(/left view/);
    // and a switch back off does not refuse the views already drawn; it only stops new ones
    await updatePresenterDraft(core, d.id, { extras: false });
    await expect(generateView(deps(), d.id, 'left', {})).rejects.toThrow(/on request/);
  });

  it('can be asked for at creation', async () => {
    const d = await createPresenterDraft(deps(), { brandId, source: 'synthetic', direction: 'someone', extras: true });
    expect(d.extras).toBe(true);
    expect(getPresenterDraft(core, d.id)?.extras).toBe(true);
  });

  it('saves the three core views when no extra was drawn, whatever the switch says', async () => {
    const d = await cast();
    await updatePresenterDraft(core, d.id, { name: 'Ilse', extras: true });
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.shots?.map((s) => s.angle)).toEqual(['portrait', 'front', 'three-quarter']);
  });

  it('saves all six in order once every extra is approved', async () => {
    const d = await castWithExtras();
    await updatePresenterDraft(core, d.id, { name: 'Ilse' });
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.shots?.map((s) => s.angle)).toEqual([
      'portrait',
      'front',
      'three-quarter',
      'back',
      'left',
      'right',
    ]);
    expect(presenter.shots?.map((s) => s.file)).toEqual(PRESENTER_VIEWS.map((v) => `asset:${d.views[v].hash}`));
    // the portrait still leads, and the crops are read off it
    expect(presenter.preview).toBe(`asset:${d.views.portrait.hash}`);
  });

  it('saves the extras that were approved and skips the ones never drawn', async () => {
    let d = await cast();
    await updatePresenterDraft(core, d.id, { name: 'Ilse', extras: true });
    d = await build(d.id, ['left']);
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.shots?.map((s) => s.angle)).toEqual(['portrait', 'front', 'three-quarter', 'left']);
  });

  it('an extra left as a candidate blocks the save, with the same words a core view uses', async () => {
    let d = await cast();
    await updatePresenterDraft(core, d.id, { name: 'Ilse', extras: true });
    d = await step(d.id, 'back');
    expect(view(d, 'back').status).toBe('candidate');
    await expect(savePresenterDraft(deps(), d.id)).rejects.toThrow('approve the back view first');
    await approveView(deps(), d.id, 'back');
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.shots?.map((s) => s.angle)).toEqual(['portrait', 'front', 'three-quarter', 'back']);
  });

  it('a photograph the analyzer files as an extra fills that slot as the original', async () => {
    const [portrait, back] = [
      core.images.save(await png('#607080', 800, 1000)),
      core.images.save(await png('#708090', 800, 1000)),
    ];
    const filing: AssetBuildDeps = {
      ...deps(),
      analyzer: {
        isAvailable: async () => ({ ok: true }),
        analyze: async (req: any) => ({
          ...(await analyzer().analyze(req)),
          photos: [
            { index: 0, view: 'portrait', usable: true, note: 'sharp' },
            { index: 1, view: 'back', usable: true, note: 'facing away' },
          ],
        }),
      } as any,
    };
    let d = await createPresenterDraft(filing, {
      brandId,
      source: 'photos',
      imageHashes: [portrait, back],
      attestation: true,
    });
    for (let i = 0; i < 200 && runningDraftJobCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'back')).toMatchObject({ status: 'approved', hash: back, origin: 'photo' });
    d = await build(d.id, ['front', 'three-quarter']);
    await updatePresenterDraft(core, d.id, { name: 'Noor' });
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.shots?.map((s) => s.angle)).toEqual(['portrait', 'front', 'three-quarter', 'back']);
  });
});

describe('a landed view can decide itself', () => {
  // The face and the full body are decided by hand, so the view that stands
  // for every self-deciding view here is the left, and the right is what is
  // drawn from it: the one dependency left among the views nobody decides.
  it('lands approved with no prior on an empty slot, and the next view is drawn from it', async () => {
    let d = await synthetic();
    await updatePresenterDraft(core, d.id, { extras: true });
    d = await build(d.id, ['portrait', 'front', 'three-quarter', 'back']);
    d = await step(d.id, 'left', undefined, 'auto');
    expect(view(d, 'left')).toMatchObject({ status: 'approved', origin: 'generated' });
    expect(view(d, 'left').prior).toBeUndefined();
    expect(view(d, 'left').attempts).toBe(1);
    d = await step(d.id, 'right', undefined, 'auto');
    expect(refsOf(generated.at(-1)!)).toEqual([view(d, 'portrait').hash, view(d, 'front').hash, view(d, 'left').hash]);
    expect(view(d, 'right').status).toBe('approved');
  });

  it('replacing an approved view keeps it as the prior, so Keep previous still works, and stales what was drawn from it', async () => {
    let d = await castWithExtras();
    const left = view(d, 'left').hash!;
    const right = view(d, 'right').hash!;
    d = await step(d.id, 'left', 'chin up', 'auto');
    expect(view(d, 'left')).toMatchObject({ status: 'approved', prior: left, adjustment: 'chin up' });
    expect(view(d, 'left').hash).not.toBe(left);
    expect(view(d, 'left').rejected).not.toContain(left);
    expect(existsSync(core.images.pathFor(left))).toBe(true);
    // the right was drawn from the old left
    expect(view(d, 'right').status).toBe('stale');
    expect(view(d, 'right').hash).toBe(right);
    await revertView(deps(), d.id, 'left');
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'left')).toMatchObject({ status: 'approved', hash: left });
    expect(view(d, 'left').prior).toBeUndefined();
  });

  it('Use on a view that decided itself settles it: the prior retires and nothing is staled twice', async () => {
    let d = await castWithExtras();
    const left = view(d, 'left').hash!;
    d = await step(d.id, 'left', undefined, 'auto');
    expect(view(d, 'left').prior).toBe(left);
    d = await step(d.id, 'right', undefined, 'auto');
    expect(view(d, 'right').status).toBe('approved');
    await approveView(deps(), d.id, 'left');
    d = getPresenterDraft(core, d.id)!;
    expect(view(d, 'left')).toMatchObject({ status: 'approved' });
    expect(view(d, 'left').prior).toBeUndefined();
    expect(view(d, 'left').rejected).toContain(left);
    expect(view(d, 'right').status).toBe('approved');
  });

  it('a save retires a prior that was never decided against, and never keeps its picture', async () => {
    let d = await castWithExtras();
    const left = view(d, 'left').hash!;
    d = await step(d.id, 'left', undefined, 'auto');
    d = await step(d.id, 'right', undefined, 'auto');
    await updatePresenterDraft(core, d.id, { name: 'Ilse' });
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.shots?.map((s) => s.file)).toContain(`asset:${view(d, 'left').hash}`);
    expect(presenter.shots?.map((s) => s.file)).not.toContain(`asset:${left}`);
    expect(existsSync(core.images.pathFor(left))).toBe(false);
  });

  it('a second self-deciding draw lets the older prior go and keeps the newest', async () => {
    let d = await castWithExtras();
    const first = view(d, 'left').hash!;
    d = await step(d.id, 'left', undefined, 'auto');
    const second = view(d, 'left').hash!;
    d = await step(d.id, 'left', undefined, 'auto');
    expect(view(d, 'left').prior).toBe(second);
    expect(view(d, 'left').rejected).toContain(first);
  });

  it('the views a person decides are refused a decision of their own', async () => {
    const d = await synthetic();
    await expect(generateView(deps(), d.id, 'portrait', { decide: 'auto' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'the face is always decided by hand',
    });
    expect(view(getPresenterDraft(core, d.id)!, 'portrait').status).toBe('empty');
    // and the full body the same way, because the gate is a row in the table
    // and not a comparison against one view's name
    await step(d.id, 'portrait');
    await approveView(deps(), d.id, 'portrait');
    await expect(generateView(deps(), d.id, 'front', { decide: 'auto' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'the front view is always decided by hand',
    });
    expect(view(getPresenterDraft(core, d.id)!, 'front').status).toBe('empty');
  });

  it('a failure lands the same way whichever way the decision was going', async () => {
    let d = await castWithExtras();
    const left = view(d, 'left').hash!;
    failNext = new Error('the engine timed out');
    d = await step(d.id, 'left', undefined, 'auto');
    expect(view(d, 'left')).toMatchObject({ status: 'approved', hash: left, error: 'the engine timed out' });
    expect(view(d, 'left').prior).toBeUndefined();
    expect(view(d, 'right').status).toBe('approved');
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

/**
 * Editing a saved person is a session seeded from the record. A candidate
 * never touches the record; a save that changes a picture or the identity
 * prose is a new record with a fresh id, because a saved shot names only the
 * id and would otherwise refine against pictures it was not made from; a save
 * that changes only the words around the person patches the record in place.
 */
describe('editing a saved presenter', () => {
  const brandJson = () => core.store.getBrand(brandId)!.json as any;
  const record = (id: string) => brandCharacters(brandJson()).find((c: any) => c.id === id) as CustomPresenter;
  const hashOf = (file: string) => file.slice(6);
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
  /** A synthetic person with the three core views, saved. */
  async function saved() {
    const d = await cast();
    await updatePresenterDraft(core, d.id, { name: 'Ilse', facets: ['Beauty'] });
    return (await savePresenterDraft(deps(), d.id)).presenter;
  }

  it('seeds a session from a three-view record: every view approved as it was, nothing drawn, nothing read', async () => {
    const p = await saved();
    const drawn = generated.length;
    const read = analyzed.length;
    const d = seedDraftFromPresenter(core, brandId, p);
    expect(d.id).toMatch(/^pd-/);
    expect(d.presenterId).toBe(p.id);
    expect(d.baseId).toBe(p.id);
    expect(d.source).toBe('synthetic');
    expect(d.name).toBe('Ilse');
    expect(d.facets).toEqual(['Beauty']);
    expect(d.direction).toBe(p.identityNotes);
    expect(d.identityEdits).toEqual([]);
    expect(d.sources).toEqual([]);
    for (const v of CORE_VIEWS) {
      expect(view(d, v)).toMatchObject({
        status: 'approved',
        origin: 'generated',
        hash: hashOf(p.shots![CORE_VIEWS.indexOf(v)].file),
      });
    }
    for (const v of EXTRA_VIEWS) expect(view(d, v).status).toBe('empty');
    expect(d.extras).toBe(false);
    expect(d.stage).toBe('idle');
    expect(d.analysis).toBeUndefined();
    expect(generated).toHaveLength(drawn);
    expect(analyzed).toHaveLength(read);
    expect(getPresenterDraft(core, d.id)?.presenterId).toBe(p.id);
  });

  it('seeds by role from a person built from photographs: a photograph in a slot is the original', async () => {
    const [a, b] = await photos(2);
    let d = await createPresenterDraft(deps(), {
      brandId,
      source: 'photos',
      imageHashes: [a, b],
      attestation: true,
      name: 'Noor',
    });
    d = await settled(d.id);
    d = await build(d.id, ['front', 'three-quarter']);
    const { presenter } = await savePresenterDraft(deps(), d.id);
    const e = seedDraftFromPresenter(core, brandId, presenter);
    expect(e.source).toBe('photos');
    expect(e.sources).toEqual([a, b]);
    expect(e.attestation?.version).toBe('v1');
    expect(view(e, 'portrait')).toMatchObject({ status: 'approved', hash: a, origin: 'photo' });
    expect(view(e, 'front')).toMatchObject({ status: 'approved', origin: 'generated' });
    expect(view(e, 'three-quarter').status).toBe('approved');
    expect(e.extras).toBe(false);
  });

  it('seeds a legacy one-shot record with no angle: the first shot is the face, the rest stay empty, nothing is drawn', async () => {
    const hash = core.images.save(await png('#606070', 800, 1000));
    const legacy: CustomPresenter = {
      id: 'up-legacy01',
      name: 'Old',
      origin: 'custom',
      shots: [{ file: `asset:${hash}` }],
      sourceRefs: [{ file: `asset:${hash}` }],
    };
    commit(core, brandId, (json) => {
      json.characters = [...brandCharacters(json), legacy];
    });
    const d = seedDraftFromPresenter(core, brandId, legacy);
    expect(view(d, 'portrait')).toMatchObject({ status: 'approved', hash, origin: 'photo' });
    for (const v of PRESENTER_VIEWS) if (v !== 'portrait') expect(view(d, v).status).toBe('empty');
    expect(d.source).toBe('photos');
    expect(d.direction).toBeUndefined();
    expect(d.keptShots).toBeUndefined();
    expect(generated).toHaveLength(0);
    // a name is enough to save it, and the record is patched where it is
    await updatePresenterDraft(core, d.id, { name: 'Older' });
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.id).toBe('up-legacy01');
    expect(presenter.name).toBe('Older');
    expect(presenter.shots).toEqual(legacy.shots);
    expect(presenter.source).toBeUndefined();
    expect(brandCharacters(brandJson())).toHaveLength(1);
  });

  it('keeps shots under an angle it has no slot for, and writes them back after the six views', async () => {
    const p = await saved();
    const odd = core.images.save(await png('#303040'));
    commit(core, brandId, (json) => {
      json.characters = brandCharacters(json).map((c: any) =>
        c.id === p.id ? { ...c, shots: [...c.shots, { file: `asset:${odd}`, angle: 'seated', locked: true }] } : c,
      );
    });
    const d = seedDraftFromPresenter(core, brandId, record(p.id));
    expect(d.keptShots).toEqual([{ file: `asset:${odd}`, angle: 'seated', locked: true }]);
    for (const v of CORE_VIEWS) expect(view(d, v).status).toBe('approved');
    await updatePresenterDraft(core, d.id, { extras: true });
    await step(d.id, 'back');
    await approveView(deps(), d.id, 'back');
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.id).not.toBe(p.id);
    expect(presenter.shots?.map((s) => s.angle)).toEqual(['portrait', 'front', 'three-quarter', 'back', 'seated']);
    expect(presenter.shots?.at(-1)?.file).toBe(`asset:${odd}`);
    // a back was added and the face was not touched: same card, same avatar
    expect(presenter.avatar).toBe(p.avatar);
    expect(presenter.preview).toBe(p.preview);
    expect(existsSync(core.images.pathFor(odd))).toBe(true);
  });

  it('a candidate never touches the record, and a discard leaves it exactly as it was', async () => {
    const p = await saved();
    const before = JSON.stringify(record(p.id));
    const d = seedDraftFromPresenter(core, brandId, p);
    const r = await step(d.id, 'front', 'arms folded');
    expect(view(r, 'front')).toMatchObject({ status: 'candidate', prior: hashOf(p.shots![1].file) });
    expect(JSON.stringify(record(p.id))).toBe(before);
    const candidate = view(r, 'front').hash!;
    await discardPresenterDraft(deps(), d.id);
    expect(JSON.stringify(record(p.id))).toBe(before);
    expect(getPresenterDraft(core, d.id)).toBeNull();
    for (const s of p.shots!) expect(existsSync(core.images.pathFor(hashOf(s.file)))).toBe(true);
    expect(existsSync(core.images.pathFor(candidate))).toBe(false);
  });

  it('a view repair is a new revision: one shot changes, and the old record keeps its old shot', async () => {
    const p = await saved();
    const d = seedDraftFromPresenter(core, brandId, p);
    await step(d.id, 'three-quarter', 'a touch more smile');
    await approveView(deps(), d.id, 'three-quarter');
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.id).not.toBe(p.id);
    expect(presenter.revisionOf).toBe(p.id);
    expect(presenter.supersededBy).toBeUndefined();
    expect(presenter.shots?.[0]).toEqual(p.shots?.[0]);
    expect(presenter.shots?.[1]).toEqual(p.shots?.[1]);
    expect(presenter.shots?.[2].file).not.toBe(p.shots?.[2].file);
    expect(presenter.shots?.[2].angle).toBe('three-quarter');
    expect(presenter.avatar).toBe(p.avatar);
    expect(presenter.preview).toBe(p.preview);
    expect(presenter.promptName).toBe(p.promptName);
    expect(presenter.facial).toBe(p.facial);
    expect(presenter.source).toBe('synthetic');
    expect(presenter.name).toBe('Ilse');
    expect(presenter.suitableCategories).toEqual(['Beauty']);
    const json = brandJson();
    const old = record(p.id);
    expect(old.supersededBy).toBe(presenter.id);
    expect(old.shots?.[2]).toEqual(p.shots?.[2]);
    expect(headOf(json, p.id)).toBe(presenter.id);
    expect(customPresenterHeads(json).map((c) => c.id)).toEqual([presenter.id]);
    expect(brandCharacters(json)).toHaveLength(2);
    // the old picture stays: the old record holds it
    expect(existsSync(core.images.pathFor(hashOf(p.shots![2].file)))).toBe(true);
    expect(getPresenterDraft(core, d.id)).toBeNull();
  });

  it('an identity accept records the edit, stales the drawn views, and the saved revision has a re-derived avatar', async () => {
    const p = await saved();
    const d = seedDraftFromPresenter(core, brandId, p);
    let r = await step(d.id, 'portrait', 'shorter hair');
    expect(view(r, 'portrait')).toMatchObject({
      status: 'candidate',
      prior: hashOf(p.shots![0].file),
      adjustment: 'shorter hair',
    });
    expect(r.identityEdits).toEqual([]);
    r = await approveView(deps(), d.id, 'portrait');
    expect(r.identityEdits).toEqual(['shorter hair']);
    expect(view(r, 'front').status).toBe('stale');
    expect(view(r, 'three-quarter').status).toBe('stale');
    // the views drawn after it are told about the change
    const plan = planStep(r, 'front', undefined, 5);
    expect(plan.prompt).toContain('except as changed here: shorter hair; the attached drawn views show the change');
    r = await build(d.id, ['front', 'three-quarter']);
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.id).not.toBe(p.id);
    expect(presenter.identityEdits).toEqual(['shorter hair']);
    expect(presenter.shots?.[0].file).toBe(`asset:${r.views.portrait.hash}`);
    expect(presenter.preview).toBe(`asset:${r.views.portrait.hash}`);
    const want = await presenterCrops(core, r.views.portrait.hash, 'portrait');
    expect(presenter.avatar).toBe(`asset:${want.avatarHash}`);
    expect(presenter.avatar).not.toBe(p.avatar);
    expect(record(p.id).shots?.[0]).toEqual(p.shots?.[0]);
    expect(record(p.id).identityEdits).toBeUndefined();
  });

  it('a name-only edit patches the record in place: same id, no new record', async () => {
    const p = await saved();
    const d = seedDraftFromPresenter(core, brandId, p);
    await updatePresenterDraft(core, d.id, { name: 'Ilse Marr', facets: ['Apparel'] });
    const { presenter } = await savePresenterDraft(deps(), d.id);
    expect(presenter.id).toBe(p.id);
    expect(presenter.name).toBe('Ilse Marr');
    expect(presenter.suitableCategories).toEqual(['Apparel']);
    expect(presenter.revisionOf).toBeUndefined();
    expect(presenter.shots).toEqual(p.shots);
    expect(presenter.avatar).toBe(p.avatar);
    expect(presenter.promptName).toBe(p.promptName);
    expect(brandCharacters(brandJson())).toHaveLength(1);
    expect(getPresenterDraft(core, d.id)).toBeNull();
  });

  it('refuses to save over a head that moved, and keeps the session for the reload', async () => {
    const p = await saved();
    const mine = seedDraftFromPresenter(core, brandId, p);
    await updatePresenterDraft(core, mine.id, { name: 'Ilse Marr' });
    // meanwhile another session saves a repair
    const theirs = seedDraftFromPresenter(core, brandId, p);
    await step(theirs.id, 'three-quarter');
    await approveView(deps(), theirs.id, 'three-quarter');
    await savePresenterDraft(deps(), theirs.id);
    await expect(savePresenterDraft(deps(), mine.id)).rejects.toMatchObject({
      statusCode: 409,
      message: /changed elsewhere/,
    });
    expect(getPresenterDraft(core, mine.id)).not.toBeNull();
    expect(record(p.id).name).toBe('Ilse');
  });

  it('headOf follows two revisions to the newest, and the chain reads back to the first', async () => {
    const p = await saved();
    const first = seedDraftFromPresenter(core, brandId, p);
    await step(first.id, 'three-quarter');
    await approveView(deps(), first.id, 'three-quarter');
    const r1 = (await savePresenterDraft(deps(), first.id)).presenter;
    // opening by the old id lands on the head
    const second = openPresenterEdit(core, brandId, p.id);
    expect(second.presenterId).toBe(r1.id);
    await step(second.id, 'three-quarter');
    await approveView(deps(), second.id, 'three-quarter');
    const r2 = (await savePresenterDraft(deps(), second.id)).presenter;
    const json = brandJson();
    expect(headOf(json, p.id)).toBe(r2.id);
    expect(headOf(json, r1.id)).toBe(r2.id);
    expect(presenterChain(json, p.id)).toEqual([r2.id, r1.id, p.id]);
    expect(customPresenterHeads(json).map((c) => c.id)).toEqual([r2.id]);
    // one open session per person, whichever id opens it
    const third = openPresenterEdit(core, brandId, p.id);
    expect(third.presenterId).toBe(r2.id);
    expect(openPresenterEdit(core, brandId, r2.id).id).toBe(third.id);
    await expect(async () => openPresenterEdit(core, brandId, 'nobody')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('mergeIdentityEdits replaces an entry about the same trait, keeps the rest, and holds eight', () => {
    expect(mergeIdentityEdits([], ' shorter  hair ')).toEqual(['shorter hair']);
    expect(mergeIdentityEdits(['shorter hair', 'a fuller beard'], 'much longer hair')).toEqual([
      'a fuller beard',
      'much longer hair',
    ]);
    expect(mergeIdentityEdits(['shorter hair'], 'Shorter hair')).toEqual(['Shorter hair']);
    expect(mergeIdentityEdits(['thicker eyebrows'], 'a lighter brow')).toEqual(['a lighter brow']);
    expect(mergeIdentityEdits(['a fuller beard'], 'no glasses')).toEqual(['a fuller beard', 'no glasses']);
    // no trait word: appended, never a replacement
    expect(mergeIdentityEdits(['shorter hair'], 'a warmer look')).toEqual(['shorter hair', 'a warmer look']);
    const many = Array.from({ length: 8 }, (_, i) => `note ${i}`);
    expect(mergeIdentityEdits(many, 'a ninth note')).toEqual([...many.slice(1), 'a ninth note']);
    expect(mergeIdentityEdits(many, '')).toEqual(many);
  });
});

describe('the asks a draft keeps', () => {
  it('every sentence sent to redraw a view stays, in order; the same one sent to the same view again is Try again, not a second ask', async () => {
    let d = await cast();
    expect(d.asks).toEqual([]);
    d = await step(d.id, 'three-quarter', 'arms relaxed', 'auto');
    d = await step(d.id, 'three-quarter', 'arms relaxed', 'auto');
    // a plain redraw sends no sentence, so it adds nothing
    d = await step(d.id, 'three-quarter', undefined, 'auto');
    expect(d.asks.map((a) => [a.view, a.text])).toEqual([['three-quarter', 'arms relaxed']]);
    d = await step(d.id, 'portrait', 'shorter hair');
    expect(d.asks.map((a) => [a.view, a.text])).toEqual([
      ['three-quarter', 'arms relaxed'],
      ['portrait', 'shorter hair'],
    ]);
    expect(d.asks.every((a) => !Number.isNaN(Date.parse(a.at)))).toBe(true);
    // the slot still says what it was last drawn with
    expect(view(d, 'portrait').adjustment).toBe('shorter hair');
  });
});

describe('the record: results, decisions, and a picture restored from before', () => {
  it('every landed picture is a result, every decision is kept, and a restore puts a picture back one to one', async () => {
    let d = await cast();
    const tq0 = view(d, 'three-quarter').hash!;
    expect(d.results.map((r) => [r.view, r.how])).toEqual([
      ['portrait', 'drawn'],
      ['front', 'drawn'],
      ['three-quarter', 'drawn'],
    ]);
    d = await step(d.id, 'three-quarter', 'arms relaxed', 'auto');
    const tq1 = view(d, 'three-quarter').hash!;
    expect(d.results.at(-1)).toMatchObject({ view: 'three-quarter', hash: tq1, ask: 'arms relaxed', how: 'drawn' });
    d = await step(d.id, 'three-quarter', 'arms up', 'auto');
    const tq2 = view(d, 'three-quarter').hash!;
    expect(view(d, 'three-quarter').rejected).toContain(tq0);
    d = await restoreView(deps(), d.id, 'three-quarter', tq0);
    expect(view(d, 'three-quarter')).toMatchObject({
      status: 'approved',
      hash: tq0,
      prior: tq2,
      origin: 'generated',
    });
    expect(view(d, 'three-quarter').adjustment).toBeUndefined();
    expect(view(d, 'three-quarter').rejected).not.toContain(tq0);
    expect(existsSync(core.images.pathFor(tq0))).toBe(true);
    // putting one back writes no row: the record is what was drawn, so going
    // back and forth never pushes the early draws out of the capped list
    expect(d.results.filter((r) => r.view === 'three-quarter')).toHaveLength(3);
    expect(d.results.every((r) => r.how === 'drawn')).toBe(true);
    // the same picture again is nothing; a stranger is refused
    expect((await restoreView(deps(), d.id, 'three-quarter', tq0)).results).toHaveLength(d.results.length);
    await expect(restoreView(deps(), d.id, 'three-quarter', 'deadbeefdeadbeefdeadbeefdeadbeef')).rejects.toMatchObject({
      statusCode: 400,
    });
    // Keep previous takes the replaced picture back, and the decisions say so
    d = await revertView(deps(), d.id, 'three-quarter');
    expect(view(d, 'three-quarter').hash).toBe(tq2);
    await redoView(deps(), d.id, 'three-quarter');
    d = getPresenterDraft(core, d.id)!;
    expect(d.decisions.map((x) => x.what).slice(-2)).toEqual(['keep', 'again']);
  });
});

describe('a draft from before the record was kept', () => {
  it('reads its pictures off the slots as results, and an adjustment as the ask it came from', async () => {
    let d = await cast();
    d = await step(d.id, 'three-quarter', 'arms relaxed', 'auto');
    // strip the record the way an older row has none, and read it back
    const { id, brandId, createdAt: _c, updatedAt: _u, ...json } = d;
    core.store.putPresenterDraft({ id, brandId, json: { ...json, asks: [], results: [], decisions: [] } });
    const back = getPresenterDraft(core, id)!;
    expect(back.results.map((r) => [r.view, r.hash, r.ask ?? null])).toEqual([
      ['portrait', d.views.portrait.hash, null],
      ['front', d.views.front.hash, null],
      ['three-quarter', d.views['three-quarter'].hash, 'arms relaxed'],
    ]);
    expect(back.asks).toEqual([expect.objectContaining({ view: 'three-quarter', text: 'arms relaxed' })]);
    expect(back.decisions).toEqual([]);
  });
});

describe('stopping a draw', () => {
  it('aborts the job, puts the slot back as it was with cancelled as the reason, and the draft goes idle', async () => {
    const d = await cast();
    const tq = view(d, 'three-quarter').hash!;
    holdNext = {};
    await generateView(deps(), d.id, 'three-quarter', { adjustment: 'arms relaxed', decide: 'auto' });
    await new Promise((r) => setTimeout(r, 20));
    expect(runningDraftJobCount()).toBe(1);
    expect(getPresenterDraft(core, d.id)!.activeView).toBe('three-quarter');
    const stopped = await stopPresenterDraft(deps(), d.id);
    expect(runningDraftJobCount()).toBe(0);
    expect(stopped.activeView).toBeNull();
    expect(stopped.stage).toBe('idle');
    expect(view(stopped, 'three-quarter')).toMatchObject({ status: 'approved', hash: tq, error: 'cancelled' });
    expect(stopped.results.filter((r) => r.view === 'three-quarter')).toHaveLength(1);
    // nothing running: a stop is nothing
    expect((await stopPresenterDraft(deps(), d.id)).views['three-quarter'].error).toBe('cancelled');
    // asked again, it draws
    const again = await step(d.id, 'three-quarter', 'arms relaxed', 'auto');
    expect(view(again, 'three-quarter').error).toBeUndefined();
    expect(view(again, 'three-quarter').hash).not.toBe(tq);
  });
});

describe('putting a picture back', () => {
  it('brings the views drawn from it back in date, rather than leaving them stranded', async () => {
    const d = await castWithExtras();
    const face = view(d, 'portrait').hash as string;
    const bodies = ['front', 'three-quarter', 'back', 'left', 'right'] as const;

    // another face is drawn and used: everything under it is out of date
    await redoView(deps(), d.id, 'portrait');
    await step(d.id, 'portrait');
    let now = await approveView(deps(), d.id, 'portrait');
    expect(now.views.portrait.hash).not.toBe(face);
    for (const v of bodies) expect(now.views[v].status).toBe('stale');

    // and the first face is put back. Those views were drawn from it and it is
    // what they are standing on again, so they are not out of date at all.
    // Marked stale for ever, the only way out was to draw all five again.
    now = await restoreView(deps(), d.id, 'portrait', face);
    expect(now.views.portrait.hash).toBe(face);
    for (const v of bodies) expect(now.views[v].status).toBe('approved');
  });

  it('asks what a view was drawn from, not what it could have been', async () => {
    // the right profile is drawn without the left one when their own words
    // name a side, so checking it against the full list found the left's
    // picture missing from its references and left it stranded as stale
    const d = await createPresenterDraft(deps(), {
      brandId,
      source: 'synthetic',
      direction: 'a man in his 30s',
      keepItems: [{ id: 'prosthetic', words: 'a prosthetic limb in place of their left arm' }],
    });
    await updatePresenterDraft(core, d.id, { extras: true });
    await build(d.id, PRESENTER_VIEWS);
    const face = getPresenterDraft(core, d.id)!.views.portrait.hash as string;
    await redoView(deps(), d.id, 'portrait');
    await step(d.id, 'portrait');
    await approveView(deps(), d.id, 'portrait');
    const back = await restoreView(deps(), d.id, 'portrait', face);
    expect(back.views.right.status).toBe('approved');
  });
});

describe('asking for another picture', () => {
  it('keeps the one it has until another lands, and puts it back when none does', async () => {
    // the face, the full body, and the three-quarter drawn from both
    const d = await cast();
    const face = view(d, 'portrait').hash;
    expect(face).toBeTruthy();

    // asked for another face: nothing downstream has moved yet, because what
    // those views were drawn from is still the picture standing here
    const again = await redoView(deps(), d.id, 'portrait');
    expect(again.views.portrait.hash).toBeUndefined();
    expect(again.views.portrait.prior).toBe(face);
    expect(again.views.front.status).toBe('approved');
    expect(again.views['three-quarter'].status).toBe('approved');

    // and the draw fails, as it does when a plan's limit runs out
    failNext = new Error("Your Codex plan's usage limit is used up until 6:13 PM.");
    const after = await step(d.id, 'portrait');
    // the view wears what it wore. Thrown away up front, this left the face
    // empty, five views staled for a redraw that never happened, and the
    // person told that nothing finished had been touched.
    expect(after.views.portrait.hash).toBe(face);
    expect(after.views.portrait.prior).toBeUndefined();
    expect(after.views.portrait.status).toBe('approved');
    expect(after.views.portrait.error).toContain('usage limit');
    expect(after.views.front.status).toBe('approved');
    expect(after.views['three-quarter'].status).toBe('approved');
  });

  it('stales what was built on it only once the new picture is used', async () => {
    const d = await cast();
    const face = view(d, 'portrait').hash;
    await redoView(deps(), d.id, 'portrait');
    const drawn = await step(d.id, 'portrait');
    expect(drawn.views.portrait.hash).not.toBe(face);
    expect(drawn.views.front.status).toBe('approved');
    // used, and now what was drawn from the old face no longer stands
    const used = await approveView(deps(), d.id, 'portrait');
    expect(used.views.front.status).toBe('stale');
    expect(used.views['three-quarter'].status).toBe('stale');
  });
});

describe('the clock measures the step', () => {
  async function settled(id: string) {
    for (let i = 0; i < 200 && runningDraftJobCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    return getPresenterDraft(core, id)!;
  }

  it('stamps the slot when the step is admitted and clears it when the step ends', async () => {
    const d = await createPresenterDraft(deps(), { brandId, source: 'synthetic', direction: 'a woman in her 30s' });
    // the stamp is the moment the work began; the row's own updated stamp
    // moves on every later write, which is why the clock cannot read it
    const { draft: started } = await generateView(deps(), d.id, 'portrait', {});
    expect(started.views.portrait.status).toBe('generating');
    expect(started.views.portrait.startedAt).toBeTruthy();
    const done = await settled(d.id);
    expect(done.views.portrait.status).toBe('candidate');
    expect(done.views.portrait.startedAt).toBeUndefined();
  });
});

describe('a draw that failed', () => {
  it('keeps the ask it was for on the slot, so a retry can draw it again with the ask', async () => {
    const d = await cast();
    failNext = new Error('the limit');
    const failed = await step(d.id, 'three-quarter', 'arms relaxed', 'auto');
    expect(view(failed, 'three-quarter')).toMatchObject({
      status: 'approved',
      error: 'the limit',
      adjustment: 'arms relaxed',
    });
    expect(failed.results.filter((r) => r.view === 'three-quarter')).toHaveLength(1);
  });
});
