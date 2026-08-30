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
  brandSceneById,
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
  /** Set when this build is re-reading an existing scene rather than making one. */
  sceneId: string | null;
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
  /**
   * Re-read a scene that already exists, instead of adding another one.
   *
   * Its stored references are the evidence, its current record is the prior
   * draft, and the result replaces it in place - same id, so every brief and
   * every shot that already names this scene keeps resolving.
   */
  sceneId?: string;
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

  const prior = input.sceneId ? brandSceneById(brand.json, input.sceneId) : undefined;
  if (input.sceneId && !prior) throw Object.assign(new Error('scene not found'), { statusCode: 404 });
  // A re-read is filed with no new uploads: its evidence is what it was built from.
  const supplied = input.imageHashes.length
    ? input.imageHashes
    : ((prior as CustomScene | undefined)?.refs ?? []).map((r) => String(r?.file ?? '').replace(/^asset:/, ''));
  const hashes = supplied.filter((h) => /^[a-f0-9]{32}$/.test(h) && core.images.has(h));
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
    sceneId: input.sceneId ?? null,
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
  /*
   * The identity frame, and it comes first because that is the order a brief
   * attaches: `shots[0]` is the essential character reference.
   *
   * Every other frame here is full-length head-to-toe, which is right for
   * build, proportion and wardrobe and useless for a face — in a 1024x1280
   * full-length frame the face is about 105px brow to chin, while a portrait
   * output renders it at four times that. Measured 2026-08-30 against the
   * reported failure: four outputs of one brief, four different jaws, and
   * drift that tracked nothing but how big the face was in the output.
   *
   * Drawn `from: 'sources'` rather than chained off the front view, because
   * the user's own photographs are the only real face evidence in the system
   * and a chain would just enlarge the same 105px.
   */
  {
    angle: 'portrait',
    from: 'sources',
    subject: (who) =>
      `${who}, head-and-shoulders portrait framing from just above the top of the head down to the collarbone, facing the camera straight-on, relaxed neutral expression, eyes to the lens, their own hair exactly as the references show it, the same plain studio backdrop and even frontal light`,
  },
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
  // "No logos" here is deliberate, not a gap: a built asset is neutral raw
  // material, and a brand mark enters a shot exactly one way, as the mark chip
  // the user places (see docs/brand-marks.md). Baking a logo into an asset
  // would put a second uncontrolled copy of it into every future shot.
  //
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
  let shotAngles: string[] = [];
  const warnings: string[] = [];
  if (deps.engine) {
    patch(job, { stage: 'building', steps: STUDIO_FRAMES.length, message: 'Building the studio views' });
    const built = await generateStudioSet(deps, job, whoIs(job.name, draft), sourcePaths, signal);
    if (built.hashes.length) {
      shotHashes = built.hashes;
      shotAngles = built.angles;
    } else warnings.push('The studio views could not be drawn, so the photos are being used directly.');
  } else {
    warnings.push('No engine could draw the studio views, so the photos are being used directly.');
  }
  if (signal.aborted) throw new Error('cancelled');

  patch(job, { stage: 'saving', message: null });
  // The geometric top-anchored crops assume an engine-drawn full-length
  // standing front view. On the no-engine path the frame is whatever the user
  // photographed — a waist-up selfie, a landscape — and top-16% is a square
  // of forehead or ceiling. Saliency picks the subject instead.
  const generated = shotHashes !== hashes;
  // The card crops are geometric and measured from a STANDING FIGURE, so they
  // come off the full-length front view by name. They used to read shots[0],
  // which was the same picture until the portrait frame took that seat: fed a
  // head-and-shoulders frame, `figureBox` would have found a head where it
  // expected a body and cropped an avatar out of a forehead.
  const frontIndex = shotAngles.indexOf('front');
  const cardSource = frontIndex === -1 ? shotHashes[0] : shotHashes[frontIndex];
  const { previewHash, avatarHash } = await presenterCrops(core, cardSource, generated ? 'generated' : 'upload');
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
    previewHash: previewHash ?? cardSource ?? null,
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
): Promise<{ hashes: string[]; angles: string[] }> {
  const engine = deps.engine;
  if (!engine) return { hashes: [], angles: [] };
  const caps = engine.capabilities();
  if (!caps.maxReferenceImages) return { hashes: [], angles: [] };
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
      // The portrait anchors nothing, so losing it costs face conditioning and
      // not the build.
      if (frame.angle === 'front') throw err;
      patch(job, { warnings: [...job.warnings, `The ${frame.angle} view could not be drawn.`] });
    }
  }
  const kept = STUDIO_FRAMES.filter((f) => byAngle.get(f.angle));
  return { hashes: kept.map((f) => byAngle.get(f.angle) as string), angles: kept.map((f) => f.angle) };
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
 * The avatar's framing, in figure proportions rather than frame pixels.
 *
 * A standing adult is about 7.5 heads tall, so the head is ~0.133 of figure
 * height (measured on a real generated frame: chin at 0.133 exactly) and the
 * shoulder line sits at ~0.17-0.18. The curated roster's own portraits frame
 * "just above the top of the head down to the collarbone", which spans about
 * figure-Y -0.02 to 0.20 — a square of 0.22 of the figure height with 10% of
 * itself as headroom. That puts the eye line at ~40% of the square (portrait
 * convention) and the head at ~60% of its height. The old 0.27 square ended
 * at the armpits: a bust, not a portrait, with the face reading at half size.
 * Tall hair is tolerated automatically — the box top IS the hair top, and the
 * square scales with the whole figure, not with the head.
 */
const AVATAR_FIGURE_FRACTION = 0.22;
const AVATAR_HEADROOM = 0.1;
/**
 * Stored avatar cap. The largest render is the presenter page's 88px hero
 * circle — 264px at 3x — so 512 covers every surface with margin; a smaller
 * native crop is stored as-is rather than inflated into blur.
 */
const AVATAR_MAX_PX = 512;
/**
 * Backdrop trim passes, in order. 12 reads a seamless white sweep; some
 * generated frames stand on a soft gray gradient that 12 cannot tell from
 * subject (it trims only left/right and reports a degenerate full-height
 * box), and a second pass at 25 recovers the true figure on those.
 */
const FIGURE_TRIM_THRESHOLDS = [12, 25];

/**
 * A square head-and-shoulders crop of the same frame, for round and small
 * surfaces.
 *
 * A 4:5 card crop of a standing figure reads as a torso once a circle is cut
 * out of it, which is what an avatar is. So this is measured from the FIGURE,
 * never from the frame: `figureBox` gives the standing figure's own bounds,
 * and the square is placed against the person by the proportions above.
 */
async function avatarCrop(core: Core, hash: string | undefined): Promise<string | undefined> {
  if (!hash || !core.images.has(hash)) return undefined;
  let box: Awaited<ReturnType<typeof figureBox>> = null;
  try {
    box = await figureBox(core.images.read(hash));
  } catch {
    box = null;
  }
  return crop(
    core,
    hash,
    (w, h) => {
      // No readable figure (a backdrop no trim pass can read, a frame that is
      // all subject): keep the old top-anchored square rather than guess.
      if (!box) {
        const size = Math.min(w, h, Math.round(h * 0.16));
        return { left: Math.max(0, Math.round((w - size) / 2)), top: 0, width: size, height: size };
      }
      const size = Math.min(w, h, Math.max(16, Math.round(box.height * AVATAR_FIGURE_FRACTION)));
      // The head sits under a little air, the way a portrait is framed.
      const top = Math.min(Math.max(0, Math.round(box.top - size * AVATAR_HEADROOM)), h - size);
      // Centred on the person, not on the frame: a figure standing off-centre
      // used to put its own face off-centre in its avatar.
      const left = Math.min(Math.max(0, Math.round(box.left + box.width / 2 - size / 2)), w - size);
      return { left, top, width: size, height: size };
    },
    AVATAR_MAX_PX,
  );
}

/**
 * The identity crop's framing, in figure proportions.
 *
 * Same measurement as the avatar above, opened up: the avatar is a 0.22 square
 * because a circle gets cut out of it, and a reference has no circle. This is
 * 0.32 of figure height at 4:5 — head, shoulders and upper chest — which is
 * the framing the curated roster's own portraits use.
 */
const IDENTITY_FIGURE_FRACTION = 0.26;
const IDENTITY_HEADROOM = 0.08;
const IDENTITY_ASPECT = 0.66;
/**
 * Measured on the first render battery: at 0.32 of figure height and 4:5, the
 * crop was 48% white studio sweep, and that sweep walked into the finished
 * pictures — a scene whose backdrop sat at a steady taupe across twelve
 * control frames came back near-white in one output of every four, and lighter
 * in the rest. The reference is the leading, essential character image, so its
 * background is not neutral evidence however clearly the role directive says
 * capture context is not styling.
 *
 * 0.26 at 2:3 is 39% sweep and roughly triples the face's share of the
 * picture. Both numbers move the right way at once, which is the only reason
 * to prefer it: less backdrop to copy, more face to read.
 */
/**
 * The height the crop is stored at, and the ceiling on how far it is inflated
 * to get there. There is no new detail in an upscale — what the crop buys is
 * the face arriving at reference SCALE rather than as a detail of a figure —
 * so past about 3x the only thing added is blur, and a blurred face is a worse
 * reference than a small sharp one.
 */
const IDENTITY_TARGET_HEIGHT = 1280;
const IDENTITY_MAX_UPSCALE = 3;

/**
 * A head-and-shoulders crop of a presenter's front frame, for conditioning.
 *
 * Why this exists at all, measured 2026-08-30 against the reported failure
 * (four outputs of one Generate 4, four different jaws):
 *
 * Every presenter reference frame is full-length head-to-toe — that is what
 * STUDIO_FRAMES asks for, and the curated roster is shot the same way. In a
 * 1024x1280 full-length frame the face is about 105px brow to chin, and only
 * one of the attached angles is frontal. A tight portrait renders that face at
 * around 450px. So the payload fixes the person's type, colouring, hair and
 * build, and says almost nothing about bone structure — and every take then
 * reconstructs the jaw, chin and brow from the prior and lands somewhere
 * else. Drift tracked face size in the output across six batches: full-body
 * runs were consistent, tight portraits were four different people of one
 * casting type.
 *
 * The crop does not add detail that was never captured. It puts the face in
 * the conditioning at a scale the model reads as the subject.
 */
export async function identityCrop(core: Core, hash: string | undefined): Promise<string | undefined> {
  if (!hash || !core.images.has(hash)) return undefined;
  // Verified before it is trusted. The memo is keyed by SOURCE hash, but the
  // value it holds is a hash in one store; handing it to a different store
  // yields a reference the compiler then silently drops on its `has` check,
  // which is a presenter arriving with no face and no error anywhere.
  const hit = identityCrops.get(hash);
  if (hit && core.images.has(hit)) return hit;
  let box: Awaited<ReturnType<typeof figureBox>> = null;
  try {
    box = await figureBox(core.images.read(hash));
  } catch {
    box = null;
  }
  // No readable figure means no trustworthy place to put the box. A wrong
  // crop is worse than none: it would attach a chest or a backdrop as the
  // identity reference. Fall back to the full frame, which is today's
  // behaviour.
  if (!box) return undefined;
  let nativeHeight = 0;
  const out = await crop(core, hash, (w, h) => {
    const height = Math.min(h, Math.max(16, Math.round(box.height * IDENTITY_FIGURE_FRACTION)));
    const width = Math.min(w, Math.max(16, Math.round(height * IDENTITY_ASPECT)));
    nativeHeight = height;
    const top = Math.min(Math.max(0, Math.round(box.top - height * IDENTITY_HEADROOM)), h - height);
    const left = Math.min(Math.max(0, Math.round(box.left + box.width / 2 - width / 2)), w - width);
    return { left, top, width, height };
  });
  if (!out) return undefined;
  // Up to reference scale, then stored under its own hash.
  try {
    const height =
      Math.min(IDENTITY_TARGET_HEIGHT, Math.round(nativeHeight * IDENTITY_MAX_UPSCALE)) || IDENTITY_TARGET_HEIGHT;
    const png = await sharp(core.images.read(out))
      .resize({ height, fit: 'inside', kernel: 'lanczos3', withoutEnlargement: false })
      .png()
      .toBuffer();
    const scaled = core.images.save(png);
    identityCrops.set(hash, scaled);
    return scaled;
  } catch {
    // The crop itself is still an improvement on the full-length frame.
    identityCrops.set(hash, out);
    return out;
  }
}

/**
 * Derived once per source image, for the life of the process. Only successes
 * are remembered: memoising a failure pins the degraded answer forever, which
 * is the bug capReferenceEdge carried.
 */
const identityCrops = new Map<string, string>();

/**
 * The brand json a brief compiles against, with every referenced presenter
 * led by a head-and-shoulders crop of their own front frame.
 *
 * Runs BEFORE compileBrief, never inside it: the compiler is deterministic and
 * synchronous by contract, and this needs sharp. The crop is prepended rather
 * than appended, so it takes the `essential` slot the front angle used to hold
 * and the third full-length angle falls off the end of CHARACTER_REF_MAX. The
 * reference COUNT is unchanged, which keeps the engine budget and every
 * eviction rule exactly where they were.
 */
export async function brandJsonWithIdentityCrops(core: Core, json: any, characterIds: string[]): Promise<any> {
  const wanted = new Set(characterIds);
  const roster: any[] = json?.characters ?? [];
  if (!wanted.size || !roster.length) return json;
  let changed = false;
  const characters = await Promise.all(
    roster.map(async (c) => {
      if (!wanted.has(c?.id) || !c?.shots?.length) return c;
      const front = String(c.shots[0]?.file ?? '').replace(/^asset:/, '') || null;
      const cropped = await identityCrop(core, front ?? undefined);
      if (!cropped) return c;
      changed = true;
      return { ...c, shots: [{ file: `asset:${cropped}`, angle: 'identity', locked: true }, ...c.shots] };
    }),
  );
  return changed ? { ...json, characters } : json;
}

/**
 * Where the standing figure actually is, against the seamless backdrop.
 *
 * `trim` reports how much uniform border it would remove, which on a studio
 * frame is exactly the backdrop around the person. Returns null when there is
 * no uniform border to remove, or when what is left is implausibly small or
 * fills the frame — either way the caller falls back rather than trusting it.
 */
async function figureBox(buf: Buffer): Promise<{ left: number; top: number; width: number; height: number } | null> {
  const meta = await sharp(buf).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return null;
  for (const threshold of FIGURE_TRIM_THRESHOLDS) {
    const { info } = await sharp(buf).trim({ threshold }).toBuffer({ resolveWithObject: true });
    const left = Math.abs(info.trimOffsetLeft ?? 0);
    const top = Math.abs(info.trimOffsetTop ?? 0);
    const width = info.width ?? 0;
    const height = info.height ?? 0;
    if (!width || !height) continue;
    // Degenerate on either axis means this pass read backdrop as subject
    // (a soft gradient under threshold): try the next pass, never trust it.
    if (width >= W || height >= H) continue;
    // A sliver is not a standing person on a backdrop.
    if (height < H * 0.3 || width < W * 0.05) continue;
    return { left, top, width, height };
  }
  return null;
}

/**
 * The presenter's two derived images, from one frame.
 *
 * `generated` frames are engine-drawn full-length standing figures by
 * construction, so the measured geometric crops are exact and cheap. An
 * `upload` is any photograph at all, so the crop is saliency-driven instead
 * (sharp's `attention` position — deterministic per pinned sharp, no model
 * spend). Either way a failed first choice falls through to the other before
 * giving up, so a presenter no longer silently ships with no avatar at all.
 */
export async function presenterCrops(
  core: Core,
  hash: string | undefined,
  mode: 'generated' | 'upload',
): Promise<{ previewHash: string | undefined; avatarHash: string | undefined }> {
  const previewHash =
    mode === 'generated'
      ? ((await cardCrop(core, hash)) ?? (await cardCropSmart(core, hash)))
      : ((await cardCropSmart(core, hash)) ?? (await cardCrop(core, hash)));
  const avatarHash =
    mode === 'generated'
      ? ((await avatarCrop(core, hash)) ?? (await avatarCropSmart(core, hash)))
      : ((await avatarCropSmart(core, hash)) ?? (await avatarCrop(core, hash)));
  return { previewHash, avatarHash };
}

/** The largest 4:5 window on the picture, placed by saliency. Best effort. */
async function cardCropSmart(core: Core, hash: string | undefined): Promise<string | undefined> {
  return smartCover(core, hash, (w, h) => {
    if (w / h > 0.8) return { width: Math.round(h * 0.8), height: h };
    return { width: w, height: Math.min(h, Math.round(w / 0.8)) };
  });
}

/** A saliency-placed square, downsampled to avatar scale. Best effort. */
async function avatarCropSmart(core: Core, hash: string | undefined): Promise<string | undefined> {
  return smartCover(core, hash, (w, h) => {
    const size = Math.min(w, h, 512);
    return { width: size, height: size };
  });
}

async function smartCover(
  core: Core,
  hash: string | undefined,
  box: (w: number, h: number) => { width: number; height: number },
): Promise<string | undefined> {
  if (!hash || !core.images.has(hash)) return undefined;
  try {
    const buf = core.images.read(hash);
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return undefined;
    const raw = box(w, h);
    // however degenerate the source, an avatar beats no avatar
    const target = { width: Math.max(1, raw.width), height: Math.max(1, raw.height) };
    const png = await sharp(buf)
      .resize(target.width, target.height, { fit: 'cover', position: 'attention' })
      .png()
      .toBuffer();
    return core.images.save(png);
  } catch {
    return undefined;
  }
}

/**
 * Cut a region out of a stored image and store the result. Best effort.
 * `cap` bounds the stored size, downscale-only: the extract is already square
 * when a cap is passed, so no resize here can ever distort.
 */
async function crop(
  core: Core,
  hash: string | undefined,
  region: (w: number, h: number) => { left: number; top: number; width: number; height: number },
  cap?: number,
): Promise<string | undefined> {
  if (!hash || !core.images.has(hash)) return undefined;
  try {
    const meta = await sharp(core.images.read(hash)).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return undefined;
    let pipeline = sharp(core.images.read(hash)).extract(region(w, h));
    if (cap) pipeline = pipeline.resize(cap, cap, { fit: 'inside', withoutEnlargement: true });
    const png = await pipeline.png().toBuffer();
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
  // A re-read revises the record it already has, so a scene built before the
  // analyzer learned to see people can be brought forward without losing its id,
  // its name, or the shots that already name it.
  const prior = job.sceneId
    ? (brandSceneById(core.store.getBrand(job.brandId)?.json ?? {}, job.sceneId) as CustomScene | undefined)
    : undefined;
  let draft: SceneDraft | null = null;
  if (deps.analyzer) {
    patch(job, { stage: 'analyzing', message: prior ? 'Reading the references again' : 'Reading the references' });
    draft = (await deps.analyzer.analyze(
      {
        kind: 'scene',
        imagePaths: hashes.map((h) => core.images.pathFor(h)),
        name: job.name,
        instruction: instruction || undefined,
        ...(prior ? { priorDraft: prior, correction: instruction || undefined } : {}),
        vocabulary: deps.vocabulary,
      },
      signal,
    )) as SceneDraft;
  } else if (!instruction) {
    throw new Error('describe the place in a sentence, or install the Codex CLI to read the references');
  }
  if (signal.aborted) throw new Error('cancelled');

  const built = sceneRecordFrom(
    {
      name: job.name || draft?.name || 'New scene',
      promptName: draft?.promptName,
      lighting: draft?.lighting,
      description: draft?.description ?? instruction,
      subject: draft?.subject ?? 'either',
      prompt: draft?.prompt ?? instruction,
      camera: draft?.camera,
      figure: draft?.figure,
      figureTreatment: draft?.figureTreatment,
      collections: draft?.collections,
      verticals: job.facets.length ? job.facets : draft?.verticals,
      keywords: draft?.keywords,
      instruction,
      refHashes: hashes,
    },
    prior,
  );
  if (!built.ok) throw new Error(built.error);
  const scene = built.scene;
  // The channel already exists, is already rendered by AssetBuildCard, and until
  // now only the presenter path ever filled it. This is where a scene says its
  // references look like different places, or are a portrait with no world in it.
  if (draft?.coverage?.length) patch(job, { coverage: draft.coverage });

  let previewHash: string | null = null;
  if (deps.engine) {
    patch(job, { stage: 'building', steps: 1, message: 'Drawing the place' });
    try {
      // The one place a scene's own references can be spent for free: this
      // draw has the engine's whole reference budget to itself. What it
      // produces is the card thumbnail AND, for a figure-led scene, the
      // identity-neutral plate a generation conditions on: drawn with "they
      // are nobody in particular", it can lend the world and the treatment
      // but never a face - which the raw upload, a full-bleed photograph of a
      // real person, demonstrably did.
      const previewRefs = hashes
        .slice(0, deps.engine.capabilities().maxReferenceImages)
        .map((h) => core.images.pathFor(h));
      previewHash = await trimEdgeBars(
        core,
        await draw(deps, {
          prompt: scenePreviewPrompt(scene),
          brandId: job.brandId,
          ...(previewRefs.length
            ? { referenceImages: previewRefs, referenceRoles: previewRefs.map(() => 'scene' as const) }
            : {}),
          signal,
        }),
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
    const rows = brandScenes(json);
    const at = rows.findIndex((s) => s?.id === scene.id);
    // Same id in the same slot on a re-read; appended when it is genuinely new.
    json.scenes = at >= 0 ? rows.map((s, i) => (i === at ? scene : s)) : [...rows, scene];
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
  // The card has to be a picture of the concept.
  //
  // Drawn empty, a world whose whole art direction is what was done to a person
  // becomes a photograph of a bare wall - which is not a modest version of that
  // scene, it is a different one. So when the concept needs a figure, the card
  // shows one. Anonymity is the thing to protect, not absence.
  //
  // The source references are attached to this draw, which is new: without the
  // refusal below the card would happily come back as the person in them.
  //
  // The word ban is scoped to what the treatment needs. The plate is the
  // conditioning image for a figure-led generation now, and a blanket "no
  // readable words" contradicted the figure-treatment doctrine's demand for
  // genuinely designed print - a sticker-treatment plate drawn print-free
  // conditioned the treatment away. Print inside the treatment follows the
  // fictional-brands doctrine word for word; everywhere else stays clean.
  const body = scene.figure
    ? `A figure is in this photograph: ${scene.figure.replace(/[.\s]+$/, '')}. ` +
      (scene.figureTreatment
        ? `The art direction is what has been done to them: ${scene.figureTreatment.replace(/[.\s]+$/, '')}, ` +
          'rendered as a real physical treatment that follows the shape it sits on. '
        : '') +
      'They are nobody in particular: do not reproduce any person from the attached reference images, and give them no ' +
      'recognisable identity. ' +
      (scene.figureTreatment
        ? 'No product and no watermarks. Where the treatment itself carries printing, render it as genuinely designed ' +
          'print - real letterforms, readable words, numerals and label-quality artwork - belonging to companies that ' +
          'are plausible but fictional, resembling no existing brand, and borrowing, extending or re-spelling no name ' +
          'that appears in any attached reference. Everywhere outside the treatment, no logos and no readable words.'
        : 'No product, no logos, no watermarks, and no readable words anywhere in the frame.')
    : 'The set is empty: no product, no person, no hands, no text, no logos, no watermarks anywhere in the frame.';
  return (
    'Full-bleed photograph filling the entire frame edge to edge with no border, frame, letterbox band or matte of any kind. ' +
    `${scene.prompt} ${scene.lighting ? `${scene.lighting}. ` : ''}` +
    body
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

/**
 * Is a build already reading this scene?
 *
 * A re-read returns its job id the moment the work starts, not when it ends, so
 * anything that re-enables its control on that response leaves a button that
 * looks ready while an analyzer is still running. Pressing it again used to
 * start a second analysis over the same record: two real Codex calls, two
 * writes racing for the same id, and the later one silently winning. The button
 * is fixed too, but the refusal belongs here, where the API can enforce it.
 */
export function sceneBuildRunning(brandId: string, sceneId: string): boolean {
  for (const b of builds.values()) {
    if (b.brandId === brandId && b.sceneId === sceneId && !b.finished) return true;
  }
  return false;
}
