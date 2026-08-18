/**
 * Presenters and scenes a brand builds for itself.
 *
 * A curated presenter or scene is a file in `templates/`. This module is the
 * same two objects, owned by one brand and stored in its `.brand` document, so
 * that everything downstream stays identical: a custom presenter is a
 * `characters[]` entry (which `compileBrief` already resolves before the
 * catalog), and a custom scene is a `scenes[]` entry the compiler is handed
 * ahead of `sceneResolver`. Nothing about generation branches on where an
 * asset came from.
 *
 * The build pipeline is where the product's promise lives. The user hands over
 * evidence: some photographs of a person, or a few images of a place. The
 * analyzer reads that into the structured record the catalogs use, and then, for
 * a person, four normalized studio frames are generated from their photographs
 * so the presenter carries the same identity plan a curated one does. Their own
 * photographs are kept as `sourceRefs` and are never overwritten: a generated
 * view is a convenience, the photographs are the evidence.
 */
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { BrandContext, Core, EngineAdapter } from '@scenri/core';
import type { PresenterDraft, SceneDraft } from '@scenri/engine-codex';

/* --------------------------------------------------------------- records */

export {
  ASSET_HEIGHT,
  ASSET_WIDTH,
  brandCharacters,
  brandSceneById,
  brandScenes,
  commit,
  isCustomPresenter,
  lintSceneProse,
  PRESENTER_ID_PREFIX,
  presenterRecordFrom,
  SCENE_ID_PREFIX,
  sceneRecordFrom,
  type CustomPresenter,
  type CustomScene,
  type CustomShot,
  type PresenterInput,
  type SceneInput,
} from './assetRecords.js';
import {
  ASSET_HEIGHT,
  str,
  strList,
  ASSET_WIDTH,
  brandCharacters,
  brandScenes,
  commit,
  lintSceneProse,
  presenterRecordFrom,
  sceneRecordFrom,
  type CustomScene,
} from './assetRecords.js';

export type AssetBuildStage = 'queued' | 'analyzing' | 'building' | 'saving' | 'done' | 'failed' | 'cancelled';

export interface AssetBuild {
  id: string;
  brandId: string;
  kind: 'presenter' | 'scene';
  name: string;
  stage: AssetBuildStage;
  /** Frames finished and frames expected, so a card can show real progress. */
  step: number;
  steps: number;
  message: string | null;
  /** Set once the asset exists in the brand. */
  assetId: string | null;
  /** Shown in the building card the moment there is something to look at. */
  previewHash: string | null;
  warnings: string[];
  /** Non-blocking notes on what another photo would buy. */
  coverage: string[];
  /** The facet values the person chose when they filed it. */
  facets: string[];
  error: string | null;
  startedAt: string;
  finished: boolean;
}

export interface Analyzer {
  isAvailable(): Promise<{ ok: boolean; reason?: string }>;
  analyze(
    req: {
      kind: 'presenter' | 'scene';
      imagePaths: string[];
      name: string;
      instruction?: string;
      correction?: string;
      priorDraft?: unknown;
      vocabulary?: { collections?: string[]; verticals?: string[]; categories?: string[] };
    },
    signal?: AbortSignal,
  ): Promise<PresenterDraft | SceneDraft>;
}

export interface AssetBuildDeps {
  core: Core;
  /** The engine that draws the studio views and scene previews. Null when none can. */
  engine: EngineAdapter | null;
  /** Reads references into structured records. Null when codex is not installed. */
  analyzer: Analyzer | null;
  brandContext: (brandId: string) => BrandContext;
  /** Facet values already in use, so a new asset lands in an existing filter. */
  vocabulary: { collections: string[]; verticals: string[]; categories: string[] };
}

export interface StartBuildInput {
  brandId: string;
  kind: 'presenter' | 'scene';
  name: string;
  instruction?: string;
  imageHashes: string[];
  /**
   * Where the person filing this says it belongs: a presenter's industries, a
   * scene's verticals. Optional, because the analyzer picks from the same list
   * when nobody says. What a person chose always wins over what it guessed.
   */
  facets?: string[];
}

const builds = new Map<string, AssetBuild>();
const running = new Map<string, AbortController>();
/** Enough history for the library page to show what just happened, not a log. */
const KEEP_PER_BRAND = 12;

export function getAssetBuild(id: string): AssetBuild | undefined {
  return builds.get(id);
}

export function listAssetBuilds(brandId: string): AssetBuild[] {
  return [...builds.values()].filter((b) => b.brandId === brandId).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export function cancelAssetBuild(id: string): boolean {
  const ctrl = running.get(id);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

/**
 * Drop a build that is over. Refuses to touch one still running — stopping work
 * is `cancelAssetBuild`'s job, and a forget that silently orphaned a live child
 * process would leave the engine drawing into nothing.
 */
export function forgetAssetBuild(id: string): boolean {
  const job = builds.get(id);
  if (!job?.finished) return false;
  return builds.delete(id);
}

/** Test seam: the module-level registry outlives a test server otherwise. */
export function resetAssetBuilds(): void {
  for (const ctrl of running.values()) ctrl.abort();
  running.clear();
  builds.clear();
}

export function startAssetBuild(deps: AssetBuildDeps, input: StartBuildInput): { jobId: string } {
  const { core } = deps;
  const brand = core.store.getBrand(input.brandId);
  if (!brand) throw Object.assign(new Error('brand not found'), { statusCode: 404 });

  const hashes = input.imageHashes.filter((h) => /^[a-f0-9]{32}$/.test(h) && core.images.has(h));
  if (input.kind === 'presenter' && !hashes.length) {
    throw Object.assign(new Error('add at least one photo of this person'), { statusCode: 400 });
  }
  if (input.kind === 'scene' && !hashes.length && !input.instruction?.trim()) {
    throw Object.assign(new Error('add a reference image, or describe the place in a sentence'), { statusCode: 400 });
  }

  const job: AssetBuild = {
    id: `ab-${randomUUID().slice(0, 8)}`,
    brandId: brand.id,
    kind: input.kind,
    name: str(input.name, 60) || (input.kind === 'presenter' ? 'New presenter' : 'New scene'),
    stage: 'queued',
    step: 0,
    steps: input.kind === 'presenter' ? STUDIO_FRAMES.length : 1,
    message: null,
    assetId: null,
    previewHash: null,
    warnings: [],
    coverage: [],
    facets: strList(input.facets, 8, 40),
    error: null,
    startedAt: new Date().toISOString(),
    finished: false,
  };
  builds.set(job.id, job);
  prune(brand.id);

  const ctrl = new AbortController();
  running.set(job.id, ctrl);
  void runBuild(deps, job, hashes, str(input.instruction, 400), ctrl.signal).finally(() => running.delete(job.id));
  return { jobId: job.id };
}

function prune(brandId: string): void {
  const mine = listAssetBuilds(brandId);
  for (const old of mine.slice(KEEP_PER_BRAND)) if (old.finished) builds.delete(old.id);
}

function patch(job: AssetBuild, next: Partial<AssetBuild>): void {
  Object.assign(job, next);
}

async function runBuild(
  deps: AssetBuildDeps,
  job: AssetBuild,
  hashes: string[],
  instruction: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    if (job.kind === 'presenter') await runPresenterBuild(deps, job, hashes, instruction, signal);
    else await runSceneBuild(deps, job, hashes, instruction, signal);
  } catch (err: any) {
    if (signal.aborted) {
      patch(job, { stage: 'cancelled', message: null, finished: true });
      return;
    }
    patch(job, { stage: 'failed', error: err?.message ?? 'build failed', message: null, finished: true });
  }
}

/* ----------------------------------------------------- presenter pipeline */

/**
 * The identity plan, ported from the curated roster's own set recipes.
 *
 * The front view is drawn from the person's photographs; every other view is
 * drawn from the front view, so the four frames are the same person seen four
 * ways rather than four attempts at a description. The right profile chains off
 * the left and asks for a mirror, which is what stops it drifting into a
 * different face.
 */
const STUDIO_FRAMES: {
  angle: string;
  from: 'sources' | 'front' | 'left-profile';
  subject: (who: string) => string;
}[] = [
  {
    angle: 'front',
    from: 'sources',
    subject: (who) =>
      `${who}, wearing a fitted off-white ribbed tank top and matching fitted off-white leggings, barefoot, standing naturally in a relaxed straight standing pose, full-length head-to-toe framing, facing the camera straight-on`,
  },
  {
    angle: 'left-profile',
    from: 'front',
    subject: () =>
      'the same person in the identical standing pose, full-length head-to-toe framing, rotated a full 90 degrees to show their left side in full profile, facing screen-left, same wardrobe',
  },
  {
    angle: 'right-profile',
    from: 'left-profile',
    subject: () =>
      'the attached image shows this exact same person in full left profile, standing: generate the precise mirror-flipped view of that same pose, the same person now in full right profile, facing the exact opposite horizontal direction, same standing pose, same wardrobe, same lighting and background',
  },
  {
    angle: 'back',
    from: 'front',
    subject: () =>
      'the same person in the identical standing pose, full-length head-to-toe framing, rotated to face fully away from the camera, back view, same wardrobe',
  },
];

/** The studio itself. Identical for every person, which is the entire point. */
const STUDIO_SET =
  'against a solid seamless white studio background, eye-level camera with gentle 85mm-equivalent portrait compression and a soft shallow depth of field, one large soft key light with gentle fill producing even, flattering, true-to-life beauty light, while keeping fine natural skin texture at pore scale and true-to-life proportions, the complexion even and uniform in tone across face, neck and shoulders, never airbrushed, plastic, or synthetic-looking, a calm quietly confident expression, true-to-life color grade with minimal retouch';

function studioPrompt(subject: string): string {
  // The clause that arrives first wins, so the full-bleed instruction leads:
  // without it the backdrop stops short and leaves flat bands down the sides.
  return (
    'Full-bleed photograph filling the entire frame edge to edge with no border, frame, letterbox band or matte of any kind, ' +
    'the seamless studio backdrop runs past all four edges and is the only thing behind the subject at every edge of the frame. ' +
    `${subject}, ${STUDIO_SET}. ` +
    'No text, no logos, no watermarks anywhere in the frame.'
  );
}

/** What the frames are told they are looking at, from the record we will store. */
function whoIs(name: string, draft: PresenterDraft | null): string {
  if (!draft) return `the exact person in the attached photographs`;
  const bits = [draft.promptName];
  if (draft.hair && !draft.promptName.toLowerCase().includes(draft.hair.toLowerCase())) bits.push(draft.hair);
  if (draft.identityNotes) bits.push(draft.identityNotes);
  return bits.filter(Boolean).join(', ') || name;
}

async function runPresenterBuild(
  deps: AssetBuildDeps,
  job: AssetBuild,
  hashes: string[],
  instruction: string,
  signal: AbortSignal,
): Promise<void> {
  const { core } = deps;
  const sourcePaths = hashes.map((h) => core.images.pathFor(h));

  let draft: PresenterDraft | null = null;
  if (deps.analyzer) {
    patch(job, { stage: 'analyzing', message: 'Reading the photos' });
    draft = (await deps.analyzer.analyze(
      {
        kind: 'presenter',
        imagePaths: sourcePaths,
        name: job.name,
        instruction: instruction || undefined,
        vocabulary: deps.vocabulary,
      },
      signal,
    )) as PresenterDraft;
    patch(job, { coverage: draft.coverage ?? [] });
  }
  if (signal.aborted) throw new Error('cancelled');

  // Without an engine the photographs are the presenter: fewer views than a
  // curated one has, but a working person rather than a blocked flow.
  let shotHashes = hashes;
  const warnings: string[] = [];
  if (deps.engine) {
    patch(job, { stage: 'building', steps: STUDIO_FRAMES.length, message: 'Building the studio views' });
    const built = await generateStudioSet(deps, job, whoIs(job.name, draft), sourcePaths, signal);
    if (built.length) shotHashes = built;
    else warnings.push('The studio views could not be drawn, so the photos are being used directly.');
  } else {
    warnings.push('No engine could draw the studio views, so the photos are being used directly.');
  }
  if (signal.aborted) throw new Error('cancelled');

  patch(job, { stage: 'saving', message: null });
  const previewHash = await cardCrop(core, shotHashes[0]);
  const avatarHash = await avatarCrop(core, shotHashes[0]);
  const built = presenterRecordFrom({
    name: job.name,
    shotHashes,
    sourceHashes: hashes,
    previewHash,
    avatarHash,
    promptName: draft?.promptName,
    presentation: draft?.presentation,
    descriptor: draft?.descriptor,
    ageRange: draft?.ageRange,
    hair: draft?.hair,
    identityNotes: draft?.identityNotes,
    negativeConstraints: draft?.negativeConstraints,
    // What the caller asked for wins over what the analyzer guessed: the
    // person choosing where this belongs knows their own library.
    suitableCategories: job.facets.length ? job.facets : draft?.suitableCategories,
  });
  if (!built.ok) throw new Error(built.error);
  commit(core, job.brandId, (json) => {
    json.characters = [...brandCharacters(json), built.presenter];
  });
  patch(job, {
    stage: 'done',
    step: job.steps,
    assetId: built.presenter.id,
    previewHash: previewHash ?? shotHashes[0] ?? null,
    warnings: [...job.warnings, ...warnings],
    finished: true,
  });
}

/**
 * Draw the four normalized views, front first so the rest can chain off it.
 *
 * A frame that fails does not fail the presenter: the views that did land are
 * kept in plan order, and the first of them is the one a brief attaches.
 */
async function generateStudioSet(
  deps: AssetBuildDeps,
  job: AssetBuild,
  who: string,
  sourcePaths: string[],
  signal: AbortSignal,
): Promise<string[]> {
  const engine = deps.engine;
  if (!engine) return [];
  const caps = engine.capabilities();
  if (!caps.maxReferenceImages) return [];
  const byAngle = new Map<string, string>();

  for (const frame of STUDIO_FRAMES) {
    if (signal.aborted) throw new Error('cancelled');
    const refs =
      frame.from === 'sources'
        ? sourcePaths.slice(0, caps.maxReferenceImages)
        : [byAngle.get(frame.from)].filter((h): h is string => !!h).map((h) => deps.core.images.pathFor(h));
    // A chained frame with no anchor would be a fresh guess at a face.
    if (!refs.length) continue;
    try {
      const drawn = await draw(deps, {
        prompt: studioPrompt(frame.subject(who)),
        brandId: job.brandId,
        referenceImages: refs,
        referenceRoles: refs.map(() => 'character' as const),
        signal,
      });
      // Before anything chains off it: a bar left on the anchor is a bar the
      // next frame is conditioned on and faithfully reproduces.
      const hash = await trimEdgeBars(deps.core, drawn);
      byAngle.set(frame.angle, hash);
      patch(job, {
        step: byAngle.size,
        previewHash: job.previewHash ?? hash,
        message: `Building the studio views (${byAngle.size} of ${STUDIO_FRAMES.length})`,
      });
    } catch (err: any) {
      if (signal.aborted) throw err;
      // The front view is the anchor; without it there is nothing to chain from.
      if (frame.angle === 'front') throw err;
      patch(job, { warnings: [...job.warnings, `The ${frame.angle} view could not be drawn.`] });
    }
  }
  return STUDIO_FRAMES.map((f) => byAngle.get(f.angle)).filter((h): h is string => !!h);
}

/**
 * Where a generated frame has flat bands down its edges, and how far in the
 * real picture starts.
 *
 * Ported from the maintainer generator, which learned this the hard way: the
 * prompt's anti-border clause argues with the picture and does not reliably
 * win, so a backdrop that stops short leaves flat bars down both sides.
 *
 * Flatness is the discriminator, not brightness. A subject standing centre
 * frame also darkens the middle lines, so an absolute threshold reads almost
 * any full-length shot as barred. A real band is near-constant AND steps into
 * more backdrop at a different level; empty space above a head steps into the
 * subject, where the variance is high.
 */
async function edgeBarGeometry(buf: Buffer) {
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  const scan = (len: number, cross: number, at: (i: number, j: number) => number) => {
    const mean = new Float64Array(len);
    const sd = new Float64Array(len);
    for (let i = 0; i < len; i++) {
      let sum = 0;
      for (let j = 0; j < cross; j++) sum += at(i, j);
      const m = sum / cross;
      let v = 0;
      for (let j = 0; j < cross; j++) v += (at(i, j) - m) ** 2;
      mean[i] = m;
      sd[i] = Math.sqrt(v / cross);
    }
    const run = (from: number, dir: number) => {
      let n = 0;
      for (let i = from; n < len * 0.2; i += dir, n++) {
        if (sd[i] >= 0.6 || Math.abs(mean[i] - mean[from]) >= 1) break;
      }
      if (n < Math.max(3, Math.round(len * 0.01))) return 0;
      const probe: number[] = [];
      for (let k = 0; k < 10; k++) {
        const i = from + dir * (n + 2 + k);
        if (i >= 0 && i < len) probe.push(i);
      }
      if (!probe.length) return 0;
      const im = probe.reduce((a, i) => a + mean[i], 0) / probe.length;
      const isd = probe.reduce((a, i) => a + sd[i], 0) / probe.length;
      // a step into backdrop that is still uniform means a synthetic band
      return Math.abs(mean[from] - im) > 2 && isd < 5 ? n : 0;
    };
    return { lo: run(0, 1), hi: run(len - 1, -1) };
  };

  const cols = scan(W, H, (x, y) => data[y * W + x]);
  const rows = scan(H, W, (y, x) => data[y * W + x]);
  return {
    W,
    H,
    left: cols.lo,
    rightBand: cols.hi,
    right: W - 1 - cols.hi,
    top: rows.lo,
    bottomBand: rows.hi,
    bottom: H - 1 - rows.hi,
  };
}

/**
 * Cut any baked-in edge bars off a generated frame.
 *
 * Best effort by design: a frame that cannot be measured, or whose measurement
 * asks to throw away half the picture, is kept exactly as it arrived. A worse
 * crop is a bigger failure than a visible band.
 */
export async function trimEdgeBars(core: Core, hash: string): Promise<string> {
  try {
    const buf = core.images.read(hash);
    const g = await edgeBarGeometry(buf);
    if (!g.left && !g.rightBand && !g.top && !g.bottomBand) return hash;
    const width = g.right - g.left + 1;
    const height = g.bottom - g.top + 1;
    if (width < g.W * 0.6 || height < g.H * 0.6) return hash;
    const png = await sharp(buf).extract({ left: g.left, top: g.top, width, height }).png().toBuffer();
    return core.images.save(png);
  } catch {
    return hash;
  }
}

/**
 * A card-sized crop of the front view, taken from the pixels we already have.
 *
 * A full-length standing figure is unreadable at card size. The curated roster
 * ships a separate thumbnail for the same reason; cropping costs no generation
 * and cannot drift from the frame it came from.
 */
async function cardCrop(core: Core, hash: string | undefined): Promise<string | undefined> {
  return crop(core, hash, (w, h) => {
    const height = Math.min(h, Math.round((h * 0.55) / 5) * 5);
    const width = Math.min(w, Math.round(height * 0.8));
    return { left: Math.max(0, Math.round((w - width) / 2)), top: 0, width, height };
  });
}

/**
 * A square head-and-shoulders crop of the same frame, for round and small
 * surfaces.
 *
 * A 4:5 card crop of a standing figure reads as a torso once a circle is cut
 * out of it, which is what an avatar is. The front view is a tight full-length
 * standing figure by construction, so the head lands in the top sixth and the
 * figure is centred; 0.16 was measured against a real generated frame, where a
 * larger square swallowed the face in chest.
 */
async function avatarCrop(core: Core, hash: string | undefined): Promise<string | undefined> {
  return crop(core, hash, (w, h) => {
    const size = Math.min(w, h, Math.round(h * 0.16));
    return { left: Math.max(0, Math.round((w - size) / 2)), top: 0, width: size, height: size };
  });
}

/** Cut a region out of a stored image and store the result. Best effort. */
async function crop(
  core: Core,
  hash: string | undefined,
  region: (w: number, h: number) => { left: number; top: number; width: number; height: number },
): Promise<string | undefined> {
  if (!hash || !core.images.has(hash)) return undefined;
  try {
    const meta = await sharp(core.images.read(hash)).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return undefined;
    const png = await sharp(core.images.read(hash)).extract(region(w, h)).png().toBuffer();
    return core.images.save(png);
  } catch {
    return undefined;
  }
}

/* --------------------------------------------------------- scene pipeline */

async function runSceneBuild(
  deps: AssetBuildDeps,
  job: AssetBuild,
  hashes: string[],
  instruction: string,
  signal: AbortSignal,
): Promise<void> {
  const { core } = deps;
  let draft: SceneDraft | null = null;
  if (deps.analyzer) {
    patch(job, { stage: 'analyzing', message: 'Reading the references' });
    draft = (await deps.analyzer.analyze(
      {
        kind: 'scene',
        imagePaths: hashes.map((h) => core.images.pathFor(h)),
        name: job.name,
        instruction: instruction || undefined,
        vocabulary: deps.vocabulary,
      },
      signal,
    )) as SceneDraft;
  } else if (!instruction) {
    throw new Error('describe the place in a sentence, or install the Codex CLI to read the references');
  }
  if (signal.aborted) throw new Error('cancelled');

  const built = sceneRecordFrom({
    name: job.name || draft?.name || 'New scene',
    promptName: draft?.promptName,
    lighting: draft?.lighting,
    description: draft?.description ?? instruction,
    subject: draft?.subject ?? 'either',
    prompt: draft?.prompt ?? instruction,
    camera: draft?.camera,
    collections: draft?.collections,
    verticals: job.facets.length ? job.facets : draft?.verticals,
    keywords: draft?.keywords,
    instruction,
    refHashes: hashes,
  });
  if (!built.ok) throw new Error(built.error);
  const scene = built.scene;

  let previewHash: string | null = null;
  if (deps.engine) {
    patch(job, { stage: 'building', steps: 1, message: 'Drawing the place' });
    try {
      previewHash = await trimEdgeBars(
        core,
        await draw(deps, { prompt: scenePreviewPrompt(scene), brandId: job.brandId, signal }),
      );
      scene.preview = `asset:${previewHash}`;
      patch(job, { step: 1, previewHash });
    } catch (err: any) {
      if (signal.aborted) throw err;
      patch(job, { warnings: [...job.warnings, 'The preview could not be drawn. The scene is still usable.'] });
    }
  }
  if (signal.aborted) throw new Error('cancelled');

  patch(job, { stage: 'saving', message: null });
  const brand = core.store.getBrand(job.brandId);
  const warnings = [...job.warnings, ...lintSceneProse(brand?.json ?? {}, scene)];
  commit(core, job.brandId, (json) => {
    json.scenes = [...brandScenes(json), scene];
  });
  patch(job, {
    stage: 'done',
    step: job.steps,
    assetId: scene.id,
    previewHash: previewHash ?? hashes[0] ?? null,
    warnings,
    finished: true,
  });
}

/**
 * The preview answers "is this the right world", so it is drawn empty.
 *
 * Staging a stand-in product or a stand-in person would be inventing exactly
 * the thing a scene is not allowed to carry, and the user would be reviewing
 * the stand-in instead of the place.
 */
export function scenePreviewPrompt(scene: CustomScene): string {
  return (
    'Full-bleed photograph filling the entire frame edge to edge with no border, frame, letterbox band or matte of any kind. ' +
    `${scene.prompt} ${scene.lighting ? `${scene.lighting}. ` : ''}` +
    'The set is empty: no product, no person, no hands, no text, no logos, no watermarks anywhere in the frame.'
  );
}

/* ----------------------------------------------------------- shared parts */

/** One image, through whichever engine the brand builds with. */
async function draw(
  deps: AssetBuildDeps,
  req: {
    prompt: string;
    brandId: string;
    referenceImages?: string[];
    referenceRoles?: ('character' | 'scene')[];
    signal: AbortSignal;
  },
): Promise<string> {
  const engine = deps.engine;
  if (!engine) throw new Error('no engine available');
  const engineId = engine.capabilities().id;
  const generateReq = {
    prompt: req.prompt,
    brand: deps.brandContext(req.brandId),
    referenceImages: req.referenceImages,
    referenceRoles: req.referenceRoles,
    width: ASSET_WIDTH,
    height: ASSET_HEIGHT,
    count: 1,
  };
  // Same budget the composer answers to: a build is generation, not metadata.
  const estimate = await engine.costEstimate(generateReq).catch(() => 0);
  deps.core.ledger.assertUnderCap(engineId, estimate);
  const result = await engine.generate(generateReq, req.signal);
  deps.core.ledger.recordCost(engineId, null, result.costUsd);
  const hash = result.images[0];
  if (!hash) throw new Error('the engine returned no image');
  return hash;
}

/**
/** How many asset builds are mid-flight — the update path refuses to restart over one. */
export function runningAssetBuildCount(): number {
  return running.size;
}
