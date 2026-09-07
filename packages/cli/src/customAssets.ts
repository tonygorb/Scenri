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

export type AssetBuildStage =
  | 'queued'
  | 'analyzing'
  | 'building'
  | 'saving'
  | 'done'
  | 'failed'
  | 'cancelled'
  // The staged scene build only. A seed is drawn, the person decides, views
  // are drawn, the person reviews the set, the set is read back once, saved.
  | 'seeding'
  | 'awaiting'
  | 'viewing'
  | 'reviewing'
  | 'consensus';

/**
 * What a frame is for. System-internal: a person sees frames, never purposes.
 * The order of VIEW_LADDER below is the order views are drawn in.
 */
export type FramePurpose = 'seed' | 'wide' | 'surface' | 'angle' | 'light' | 'zone' | 'upload';
export type FrameOrigin = 'seed' | 'view' | 'upload';

export interface BuildFrame {
  /** Null while the engine is still drawing it. */
  hash: string | null;
  purpose: FramePurpose;
  status: 'drawing' | 'landed' | 'rejected';
  origin: FrameOrigin;
  /** The hashes attached to the draw, in the order they were handed over. */
  drawnFrom?: string[];
  /** Wall clock of the draw, and which attempt at this purpose it was. */
  ms?: number;
  attempt?: number;
}

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
  /* ---- the staged scene build only; a presenter job never carries these */
  /** Every frame on the board, uploads included, in the order they arrived. */
  frames?: BuildFrame[];
  /** The scene as read so far; canonical once the seed is approved. */
  record?: CustomScene | null;
  /** What the analyzer would call this place, offered at review, never imposed. */
  suggestedName?: string | null;
  /** The frame the card will show. Defaults to the seed. */
  cover?: string | null;
  /** How many frames the set is built to, uploads counted. */
  target?: number;
  /** Whether the set is read back once before saving. */
  consensus?: boolean;
  /** When each stage was entered, for the timing report. */
  stageAt?: Record<string, string>;
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
  /** Take a frame this build drew and then decided against back off disk. */
  discard?: (hash: string) => Promise<void>;
  /** A debug line per draw, when the server is asked for one. */
  log?: (fields: Record<string, unknown>, msg: string) => void;
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
  /** Scene only: how many frames the set is built to, four to six. */
  target?: number;
  /** Scene only: read the finished set back once before saving. */
  consensus?: boolean;
  /**
   * Scene only: which of `imageHashes` this app drew in an earlier attempt.
   * A resumed build hands its approved frames back as images; this keeps them
   * marked as drawn, which is what lets one be a figure-led scene's cover.
   */
  drawnHashes?: string[];
}

/* ------------------------------------------------------------- registry */

export const SCENE_SET_MIN = 4;
export const SCENE_SET_MAX = 6;
/** The default size of a scene's set, seed and uploads counted. */
export function defaultSceneTarget(): number {
  const n = Number(process.env.SCENRI_SCENE_TARGET);
  return Number.isInteger(n) && n >= SCENE_SET_MIN && n <= SCENE_SET_MAX ? n : 4;
}
/** Whether a finished set is read back once before saving, until the benchmark settles it. */
export function defaultSceneConsensus(): boolean {
  return process.env.SCENRI_SCENE_CONSENSUS !== '0';
}
/** A build left waiting for a person this long is over. */
const PAUSE_TTL_MS = 30 * 60_000;
const PAUSED = new Set<AssetBuildStage>(['awaiting', 'reviewing']);

/**
 * What a staged scene build keeps beside its job: never serialised, gone when
 * the job finishes. The job is what a poll returns; this is what the steps
 * need to run.
 */
interface SceneJobContext {
  deps: AssetBuildDeps;
  instruction: string;
  /** What the person uploaded. Never cleaned, never redrawn. */
  uploads: string[];
  /** Uploads this app drew in an earlier attempt: eligible as a figure scene's cover. */
  priorDrawn: Set<string>;
  /** The seed is approved: the record is the canonical world now. */
  locked: boolean;
  /** Every hash this build drew, and the untrimmed originals it superseded. */
  drawn: Set<string>;
  raw: Set<string>;
  /** Purposes that failed to draw, so the loop does not retry them forever. */
  failedPurposes: Set<FramePurpose>;
  idle: NodeJS.Timeout | null;
}
const contexts = new Map<string, SceneJobContext>();

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
  if (ctrl) {
    ctrl.abort();
    return true;
  }
  // A paused scene build has no promise to abort; it is ended by hand.
  const job = builds.get(id);
  if (job && !job.finished && contexts.has(job.id)) {
    void finishJob(job, 'cancelled');
    return true;
  }
  return false;
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
  for (const ctx of contexts.values()) if (ctx.idle) clearTimeout(ctx.idle);
  contexts.clear();
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
  // A new scene is built in stages the person steers; a re-read stays linear.
  const staged = input.kind === 'scene' && !input.sceneId;
  if (staged) {
    // One at a time per brand: the local engine rate-limits parallel draws into
    // silence, and two boards steered from one dialog would be two dialogs.
    const live = [...builds.values()].find((b) => b.brandId === brand.id && b.kind === 'scene' && !b.finished);
    if (live) {
      throw Object.assign(new Error('a scene is already being built for this brand'), {
        statusCode: 409,
        jobId: live.id,
      });
    }
    if (input.target !== undefined) {
      const t = Number(input.target);
      if (!Number.isInteger(t) || t < SCENE_SET_MIN || t > SCENE_SET_MAX) {
        throw Object.assign(new Error(`a set holds ${SCENE_SET_MIN} to ${SCENE_SET_MAX} frames`), { statusCode: 400 });
      }
    }
  }
  const target = staged ? (input.target ?? defaultSceneTarget()) : 1;
  const instruction = str(input.instruction, 400);

  const job: AssetBuild = {
    id: `ab-${randomUUID().slice(0, 8)}`,
    brandId: brand.id,
    kind: input.kind,
    // A staged scene is named at the end, once there is something to name.
    name: staged
      ? str(input.name, 60)
      : str(input.name, 60) || (input.kind === 'presenter' ? 'New presenter' : 'New scene'),
    stage: 'queued',
    step: 0,
    steps: input.kind === 'presenter' ? STUDIO_FRAMES.length : target,
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
    ...(staged
      ? {
          frames: hashes.map((hash) => ({
            hash,
            purpose: 'upload' as const,
            status: 'landed' as const,
            origin: 'upload' as const,
          })),
          record: null,
          suggestedName: null,
          cover: null,
          target,
          consensus: input.consensus ?? defaultSceneConsensus(),
          stageAt: {},
        }
      : {}),
  };
  builds.set(job.id, job);
  prune(brand.id);

  if (staged) {
    const priorDrawn = new Set(strList(input.drawnHashes, 8, 64).filter((h) => hashes.includes(h)));
    contexts.set(job.id, {
      deps,
      instruction,
      uploads: hashes,
      priorDrawn,
      locked: false,
      drawn: new Set(),
      raw: new Set(),
      failedPurposes: new Set(),
      idle: null,
    });
    void advance(job, (signal) => analyzeAndSeed(job, signal));
    return { jobId: job.id };
  }

  const ctrl = new AbortController();
  running.set(job.id, ctrl);
  void runBuild(deps, job, hashes, instruction, ctrl.signal).finally(() => running.delete(job.id));
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
    shotAngles,
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
 * How much taller than wide a figure box has to be before it counts as a
 * standing full-length figure rather than a portrait already. Measured: a
 * curated standing frame is 1176 by 312, so 3.8; a head-and-shoulders crop
 * lands near 1. Anything between is ambiguous and is left alone.
 */
const STANDING_FIGURE_RATIO = 2.2;

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
  // And only ever crop a STANDING FIGURE. This whole geometry is measured in
  // figure heights off a full-length frame; run it on a picture that is
  // already a head-and-shoulders portrait and it carves a forehead out of a
  // face. A standing figure is far taller than it is wide (a real curated
  // frame measures 1176 by 312, so 3.8); a portrait's box is near square.
  if (box.height / Math.max(1, box.width) < STANDING_FIGURE_RATIO) return undefined;
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
      // A presenter who already leads with a real portrait needs nothing from
      // here. The curated roster ships one (avatar.jpg, 1024x1024) and every
      // presenter built since the studio set grew one draws its own; the
      // derived crop below stands in only for the casts that predate both.
      //
      // The portrait is attached exactly as shipped, sweep and all. A trim
      // that boxed it tighter was built and measured (3 batches either way):
      // identity held 12/12 both times, and the occasional light-backdrop
      // frame appeared at the same rate trimmed or not — while the control's
      // refs were 85% sweep and never leaked once. The leak is not the
      // sweep's share of the reference; it is the portrait's FRAMING matching
      // the output's, which no crop changes. So the pixels ship untouched.
      if (c.shots[0]?.angle === 'portrait') return c;
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

/* ------------------------------------------------- staged scene pipeline */

/**
 * A scene built in stages a person steers.
 *
 * The seed is one frame of the world as read; the person says yes to it, or
 * asks again, or adjusts the reading. Yes locks the record. Views are then
 * drawn from that record with the seed attached, each for a purpose the
 * ladder below names, until the set is the size it was built to. The person
 * reviews the set, picks a cover, names it, saves. Between those moments the
 * job is paused: no promise, no controller, a timer that ends it if nobody
 * comes back.
 *
 * Nothing here reaches a shot. The frames are evidence for the person and,
 * read back once at the end, for the record; the cover is the card, and for a
 * figure-led scene the plate the compiler already attaches beside a presenter.
 */

const need = (job: AssetBuild): SceneJobContext => {
  const ctx = contexts.get(job.id);
  if (!ctx) throw Object.assign(new Error('this build is over'), { statusCode: 409 });
  return ctx;
};

function fail(message: string, statusCode: number): never {
  throw Object.assign(new Error(message), { statusCode });
}

function setStage(job: AssetBuild, stage: AssetBuildStage, message: string | null): void {
  patch(job, { stage, message });
  if (job.stageAt) job.stageAt[stage] = new Date().toISOString();
}

function clearIdle(job: AssetBuild): void {
  const ctx = contexts.get(job.id);
  if (ctx?.idle) {
    clearTimeout(ctx.idle);
    ctx.idle = null;
  }
}

function armIdle(job: AssetBuild): void {
  const ctx = contexts.get(job.id);
  if (!ctx) return;
  clearIdle(job);
  ctx.idle = setTimeout(() => {
    if (job.finished || !PAUSED.has(job.stage)) return;
    patch(job, { warnings: [...job.warnings, 'Left unattended for 30 minutes.'] });
    void finishJob(job, 'cancelled');
  }, PAUSE_TTL_MS);
  ctx.idle.unref?.();
}

/**
 * Run one step of a staged build to its next pause. The controller lives only
 * for the step, so a paused job has nothing to abort and cancel ends it by
 * hand; a step that throws ends the job the way `runBuild` always has.
 */
async function advance(job: AssetBuild, step: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const ctrl = new AbortController();
  running.set(job.id, ctrl);
  clearIdle(job);
  try {
    await step(ctrl.signal);
  } catch (err: any) {
    if (ctrl.signal.aborted) await finishJob(job, 'cancelled');
    else await finishJob(job, 'failed', err?.message ?? 'build failed');
  } finally {
    running.delete(job.id);
    if (!job.finished && PAUSED.has(job.stage)) armIdle(job);
  }
}

const finishing = new Set<string>();
async function finishJob(
  job: AssetBuild,
  stage: 'done' | 'failed' | 'cancelled',
  error?: string,
  keep: Set<string> = new Set(),
): Promise<void> {
  if (job.finished || finishing.has(job.id)) return;
  finishing.add(job.id);
  try {
    // Clean before the job reads as finished: whoever polls "done" and then
    // looks at the disk must find the frames already gone.
    const ctx = contexts.get(job.id);
    if (ctx) {
      clearIdle(job);
      contexts.delete(job.id);
      await cleanupSceneJob(ctx, keep).catch(() => {});
    }
    setStage(job, stage, null);
    patch(job, { finished: true, error: error ?? null });
  } finally {
    finishing.delete(job.id);
  }
}

/**
 * Take back what this build drew and nobody kept. Uploads are never touched,
 * nor anything a brand document points at, nor the frames a resumed build
 * was handed. Best effort: a file that will not go is a file that stays.
 */
async function cleanupSceneJob(ctx: SceneJobContext, keep: Set<string>): Promise<void> {
  if (!ctx.deps.discard) return;
  const candidates = new Set([...ctx.drawn, ...ctx.raw]);
  for (const h of keep) candidates.delete(h);
  for (const h of ctx.uploads) candidates.delete(h);
  for (const h of ctx.priorDrawn) candidates.delete(h);
  if (!candidates.size) return;
  const referenced = ctx.deps.core.store
    .listBrands()
    .map((b) => JSON.stringify(b.json ?? ''))
    .join('\n');
  for (const h of candidates) {
    if (referenced.includes(`asset:${h}`)) continue;
    await ctx.deps.discard(h).catch(() => {});
  }
}

const landedFrames = (job: AssetBuild): BuildFrame[] => (job.frames ?? []).filter((f) => f.status === 'landed');
const seedFrame = (job: AssetBuild): BuildFrame | undefined => landedFrames(job).find((f) => f.origin === 'seed');
const frameByHash = (job: AssetBuild, hash: string): BuildFrame | undefined =>
  landedFrames(job).find((f) => f.hash === hash);
const isBusy = (job: AssetBuild): boolean => running.has(job.id);

/** Uploads first in the order they came, then what was drawn, seed first, in ladder order. */
function boardOrder(job: AssetBuild): BuildFrame[] {
  const landed = landedFrames(job);
  const rank = (f: BuildFrame) => (f.origin === 'seed' ? 0 : VIEW_LADDER.findIndex((v) => v.purpose === f.purpose) + 1);
  return [
    ...landed.filter((f) => f.origin === 'upload'),
    ...landed.filter((f) => f.origin !== 'upload').sort((a, b) => rank(a) - rank(b)),
  ];
}

/** Turn what the analyzer read into the job's record. `base` keeps the id across a revision. */
function adoptDraft(job: AssetBuild, ctx: SceneJobContext, draft: SceneDraft | null, base?: CustomScene): void {
  const built = sceneRecordFrom(
    {
      name: job.name || draft?.name || base?.name || 'New scene',
      promptName: draft?.promptName,
      lighting: draft?.lighting,
      description: draft?.description ?? ctx.instruction,
      subject: draft?.subject ?? base?.subject ?? 'either',
      prompt: draft?.prompt ?? ctx.instruction,
      camera: draft?.camera,
      figure: draft?.figure,
      figureTreatment: draft?.figureTreatment,
      collections: draft?.collections,
      verticals: job.facets.length ? job.facets : draft?.verticals,
      keywords: draft?.keywords,
      instruction: ctx.instruction,
      refHashes: ctx.uploads,
      drawnHashes: [...ctx.priorDrawn],
    },
    base,
  );
  if (!built.ok) throw new Error(built.error);
  patch(job, { record: built.scene, suggestedName: draft?.name ?? job.suggestedName ?? null });
  if (draft?.coverage?.length) patch(job, { coverage: draft.coverage });
}

async function readScene(
  job: AssetBuild,
  ctx: SceneJobContext,
  signal: AbortSignal,
  revision?: { priorDraft: CustomScene; correction: string; imagePaths?: string[] },
): Promise<SceneDraft> {
  const { core } = ctx.deps;
  if (!ctx.deps.analyzer)
    throw new Error('describe the place in a sentence, or install the Codex CLI to read the references');
  return (await ctx.deps.analyzer.analyze(
    {
      kind: 'scene',
      imagePaths: revision?.imagePaths ?? ctx.uploads.map((h) => core.images.pathFor(h)),
      name: job.name,
      instruction: ctx.instruction || undefined,
      ...(revision ? { priorDraft: revision.priorDraft, correction: revision.correction } : {}),
      vocabulary: ctx.deps.vocabulary,
    },
    signal,
  )) as SceneDraft;
}

/** Stage one: read, then either draw the seed or, with enough uploads, go straight to review. */
async function analyzeAndSeed(job: AssetBuild, signal: AbortSignal): Promise<void> {
  const ctx = need(job);
  let draft: SceneDraft | null = null;
  if (ctx.deps.analyzer) {
    setStage(job, 'analyzing', ctx.uploads.length ? 'Reading the references' : 'Reading the direction');
    draft = await readScene(job, ctx, signal);
  } else if (!ctx.instruction) {
    throw new Error('describe the place in a sentence, or install the Codex CLI to read the references');
  }
  if (signal.aborted) throw new Error('cancelled');
  adoptDraft(job, ctx, draft);
  if (!ctx.deps.engine) {
    patch(job, { warnings: [...job.warnings, 'No engine here can draw, so the set is what you uploaded.'] });
    ctx.locked = true;
    setStage(job, 'reviewing', null);
    return;
  }
  // Enough uploads make a set on their own. A figure-led scene still draws its
  // seed: the plate a presenter is shown beside is never a raw upload.
  if (ctx.uploads.length >= 3 && !job.record?.figure) {
    ctx.locked = true;
    setStage(job, 'reviewing', null);
    return;
  }
  await drawSeed(job, ctx, signal);
}

async function drawFrame(
  job: AssetBuild,
  ctx: SceneJobContext,
  opts: { purpose: FramePurpose; origin: FrameOrigin; prompt: string; refs: string[]; signal: AbortSignal },
): Promise<BuildFrame> {
  const { core } = ctx.deps;
  const frames = job.frames ?? [];
  const attempt = frames.filter((f) => f.purpose === opts.purpose && f.origin !== 'upload').length + 1;
  const frame: BuildFrame = {
    hash: null,
    purpose: opts.purpose,
    status: 'drawing',
    origin: opts.origin,
    drawnFrom: opts.refs,
    attempt,
  };
  patch(job, { frames: [...frames, frame] });
  const t0 = Date.now();
  try {
    const raw = await draw(ctx.deps, {
      prompt: opts.prompt,
      brandId: job.brandId,
      ...(opts.refs.length
        ? {
            referenceImages: opts.refs.map((h) => core.images.pathFor(h)),
            referenceRoles: opts.refs.map(() => 'scene' as const),
          }
        : {}),
      signal: opts.signal,
      label: opts.purpose,
    });
    const hash = await trimEdgeBars(core, raw);
    if (hash !== raw) ctx.raw.add(raw);
    ctx.drawn.add(hash);
    Object.assign(frame, { hash, status: 'landed', ms: Date.now() - t0 });
    patch(job, { frames: [...(job.frames ?? [])] });
    return frame;
  } catch (err) {
    patch(job, { frames: (job.frames ?? []).filter((f) => f !== frame) });
    throw err;
  }
}

/** The seed: the world as read, drawn the way the card always was, from the uploads. */
async function drawSeed(job: AssetBuild, ctx: SceneJobContext, signal: AbortSignal): Promise<void> {
  const record = job.record;
  if (!record || !ctx.deps.engine) throw new Error('nothing to draw from');
  setStage(job, 'seeding', 'Drawing the world');
  const refs = ctx.uploads.slice(0, ctx.deps.engine.capabilities().maxReferenceImages);
  const frame = await drawFrame(job, ctx, {
    purpose: 'seed',
    origin: 'seed',
    prompt: scenePreviewPrompt(record),
    refs,
    signal,
  });
  patch(job, { cover: frame.hash, previewHash: frame.hash, step: landedFrames(job).length });
  setStage(job, 'awaiting', null);
}

/**
 * What a view is drawn from: the seed always first, then up to three other
 * drawn frames in ladder order, never an upload. The world reached the seed
 * through the uploads; attaching them again would hand the person or product
 * in them straight back. A set that has no seed (enough uploads, then "add a
 * view") draws from the uploads the way the seed would have.
 */
function viewRefs(job: AssetBuild, ctx: SceneJobContext): string[] {
  const cap = ctx.deps.engine?.capabilities().maxReferenceImages ?? 0;
  const seed = seedFrame(job)?.hash;
  if (!seed) return ctx.uploads.slice(0, cap);
  const others = boardOrder(job)
    .filter((f) => f.origin === 'view' && f.hash && f.hash !== seed)
    .map((f) => f.hash as string);
  return [seed, ...others.slice(0, Math.max(0, Math.min(3, cap - 1)))];
}

function nextPurpose(job: AssetBuild, ctx: SceneJobContext): FramePurpose | null {
  return (
    viewLadder(job.target ?? SCENE_SET_MIN).find(
      (p) => !ctx.failedPurposes.has(p) && !(job.frames ?? []).some((f) => f.purpose === p && f.status !== 'rejected'),
    ) ?? null
  );
}

/** Views, one at a time, until the set is the size it was built to. */
async function drawViews(job: AssetBuild, ctx: SceneJobContext, signal: AbortSignal): Promise<void> {
  const target = job.target ?? SCENE_SET_MIN;
  setStage(job, 'viewing', null);
  for (;;) {
    if (signal.aborted) throw new Error('cancelled');
    const count = landedFrames(job).length;
    patch(job, { step: count, steps: target });
    if (count >= target) break;
    const purpose = nextPurpose(job, ctx);
    if (!purpose) break;
    patch(job, { message: `Drawing the world (${count + 1} of ${target})` });
    try {
      await drawFrame(job, ctx, {
        purpose,
        origin: 'view',
        prompt: sceneViewPrompt(job.record as CustomScene, purpose),
        refs: viewRefs(job, ctx),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      ctx.failedPurposes.add(purpose);
      patch(job, { warnings: [...job.warnings, 'A view could not be drawn. The set goes on without it.'] });
    }
  }
  patch(job, { step: landedFrames(job).length, message: null });
  setStage(job, 'reviewing', null);
}

/** Read the finished set back once, then write the scene. */
async function saveScene(job: AssetBuild, ctx: SceneJobContext, signal: AbortSignal): Promise<void> {
  const { core } = ctx.deps;
  const record = job.record as CustomScene;
  const board = boardOrder(job);
  if (job.consensus && board.length >= 2 && ctx.deps.analyzer) {
    setStage(job, 'consensus', 'Reading the set');
    try {
      // Seed first, then the views, then the uploads: the drawn frames are the
      // record's own evidence; the uploads are what it was read from.
      const ordered = [...board.filter((f) => f.origin !== 'upload'), ...board.filter((f) => f.origin === 'upload')];
      const draft = await readScene(job, ctx, signal, {
        priorDraft: record,
        correction: CONSENSUS_NOTE,
        imagePaths: ordered.map((f) => core.images.pathFor(f.hash as string)),
      });
      // Only what the set can teach: how the place reads and how the camera
      // moves across it. The figure, its treatment and the subject were settled
      // when the seed was approved, and a drawn frame must not re-derive them.
      const merged = sceneRecordFrom(
        {
          prompt: draft.prompt,
          lighting: draft.lighting,
          camera: draft.camera,
          description: draft.description,
          keywords: draft.keywords,
        },
        record,
      );
      if (merged.ok) patch(job, { record: merged.scene });
    } catch (err) {
      if (signal.aborted) throw err;
      patch(job, { warnings: [...job.warnings, 'The set could not be read back. The first reading stands.'] });
    }
  }
  if (signal.aborted) throw new Error('cancelled');
  setStage(job, 'saving', null);
  const uploads = board.filter((f) => f.origin === 'upload').map((f) => f.hash as string);
  const drawn = board.filter((f) => f.origin !== 'upload').map((f) => f.hash as string);
  const built = sceneRecordFrom(
    {
      name: job.name,
      ...(job.facets.length ? { verticals: job.facets } : {}),
      refHashes: [...uploads, ...drawn],
      drawnHashes: [...drawn, ...ctx.priorDrawn],
      previewHash: job.cover,
    },
    job.record as CustomScene,
  );
  if (!built.ok) throw new Error(built.error);
  const scene = built.scene;
  const brand = core.store.getBrand(job.brandId);
  const warnings = [...job.warnings, ...lintSceneProse(brand?.json ?? {}, scene)];
  commit(core, job.brandId, (json) => {
    json.scenes = [...brandScenes(json), scene];
  });
  patch(job, { record: scene, assetId: scene.id, previewHash: job.cover, warnings, step: job.steps });
  const keep = new Set<string>([...uploads, ...drawn]);
  if (job.cover) keep.add(job.cover);
  await finishJob(job, 'done', undefined, keep);
}

/* ----- what a person can do to a staged build, one function per route */

const wantStage = (job: AssetBuild, allowed: AssetBuildStage[]): void => {
  if (job.finished || !allowed.includes(job.stage)) fail('the build is not waiting for that', 409);
};
const wantIdle = (job: AssetBuild): void => {
  if (isBusy(job)) fail('the build is busy', 409);
};

/** Yes, this world: the record is canonical, the views begin. */
export function approveSceneBuild(job: AssetBuild): void {
  const ctx = need(job);
  wantIdle(job);
  wantStage(job, ['awaiting']);
  ctx.locked = true;
  if (ctx.uploads.length >= 3) {
    setStage(job, 'reviewing', null);
    armIdle(job);
    return;
  }
  void advance(job, (signal) => drawViews(job, ctx, signal));
}

/**
 * Draw the seed again, or one view again. A view rejected while views are
 * still being drawn is picked up by that loop; otherwise the loop is started.
 */
export function retrySceneFrame(job: AssetBuild, hash?: string): { queued: boolean } {
  const ctx = need(job);
  if (!ctx.deps.engine) fail('no engine here can draw', 409);
  if (!hash) {
    wantIdle(job);
    wantStage(job, ['awaiting']);
    const seed = seedFrame(job);
    if (seed) seed.status = 'rejected';
    void advance(job, (signal) => drawSeed(job, ctx, signal));
    return { queued: false };
  }
  const frame = frameByHash(job, hash);
  if (!frame) fail('no such frame on this build', 404);
  if (frame.origin === 'upload') fail('uploads are not redrawn', 400);
  if (frame.origin === 'seed') {
    if (job.stage !== 'awaiting') fail('the seed is approved; redraw a view, or stop and start again', 400);
    return retrySceneFrame(job);
  }
  wantStage(job, ['viewing', 'reviewing']);
  frame.status = 'rejected';
  if (job.cover === hash) patch(job, { cover: seedFrame(job)?.hash ?? landedFrames(job)[0]?.hash ?? null });
  patch(job, { frames: [...(job.frames ?? [])] });
  if (isBusy(job)) return { queued: true };
  void advance(job, (signal) => drawViews(job, ctx, signal));
  return { queued: false };
}

/** One line of correction to the reading, then the seed again. */
export function adjustSceneBuild(job: AssetBuild, note: string): void {
  const ctx = need(job);
  wantIdle(job);
  wantStage(job, ['awaiting']);
  const line = str(note, 400);
  if (!line) fail('say what to change', 400);
  if (!ctx.deps.analyzer) fail('no analyzer here can read a correction', 409);
  const seed = seedFrame(job);
  if (seed) seed.status = 'rejected';
  void advance(job, async (signal) => {
    setStage(job, 'analyzing', 'Reading it again');
    const draft = await readScene(job, ctx, signal, { priorDraft: job.record as CustomScene, correction: line });
    if (signal.aborted) throw new Error('cancelled');
    adoptDraft(job, ctx, draft, job.record as CustomScene);
    await drawSeed(job, ctx, signal);
  });
}

/** Take a frame off the board. Below the target, a replacement is drawn. */
export function removeSceneFrame(job: AssetBuild, hash: string): void {
  const ctx = need(job);
  wantStage(job, ['viewing', 'reviewing']);
  const frame = frameByHash(job, hash);
  if (!frame) fail('no such frame on this build', 404);
  if (frame.origin === 'seed') fail('the first frame stays; redraw a view, or stop and start again', 400);
  frame.status = 'rejected';
  if (job.cover === hash) patch(job, { cover: seedFrame(job)?.hash ?? landedFrames(job)[0]?.hash ?? null });
  patch(job, { frames: [...(job.frames ?? [])] });
  if (isBusy(job) || job.stage !== 'reviewing') return;
  if (landedFrames(job).length < (job.target ?? SCENE_SET_MIN) && ctx.deps.engine) {
    void advance(job, (signal) => drawViews(job, ctx, signal));
  } else armIdle(job);
}

/** One more view, up to six frames on the board. */
export function addSceneView(job: AssetBuild): void {
  const ctx = need(job);
  wantIdle(job);
  wantStage(job, ['reviewing']);
  if (!ctx.deps.engine) fail('no engine here can draw', 409);
  const count = landedFrames(job).length;
  if (count >= SCENE_SET_MAX) fail(`${SCENE_SET_MAX} frames is the most a set holds`, 409);
  patch(job, { target: Math.min(SCENE_SET_MAX, count + 1) });
  void advance(job, (signal) => drawViews(job, ctx, signal));
}

/** Name it, pick the cover, save. */
export function finishSceneBuild(
  job: AssetBuild,
  input: { name?: unknown; cover?: unknown; facets?: unknown; consensus?: unknown },
): void {
  const ctx = need(job);
  wantIdle(job);
  wantStage(job, ['reviewing']);
  const name = str(input.name, 60);
  if (!name) fail('name this scene', 400);
  const landed = landedFrames(job);
  if (!landed.length) fail('there is no frame to save', 400);
  const wanted = input.cover === undefined || input.cover === null ? null : String(input.cover);
  const cover = wanted ?? job.cover ?? seedFrame(job)?.hash ?? landed[0]?.hash ?? null;
  const coverFrame = cover ? frameByHash(job, cover) : undefined;
  if (!coverFrame) fail('the cover has to be a frame on the board', 400);
  if (job.record?.figure && coverFrame.origin === 'upload' && !ctx.priorDrawn.has(cover as string)) {
    fail("a figure-led scene's cover is its plate, so it has to be a drawn frame", 400);
  }
  const facets = Array.isArray(input.facets) ? strList(input.facets, 8, 40) : null;
  patch(job, {
    name,
    cover,
    ...(facets ? { facets } : {}),
    ...(typeof input.consensus === 'boolean' ? { consensus: input.consensus } : {}),
  });
  void advance(job, (signal) => saveScene(job, ctx, signal));
}

/* ------------------------------------------------ the words a view is drawn with */

/**
 * The clause every view carries: the attached frames are this world, and this
 * is another photograph of it. "The same image from another angle" gives back
 * the same image; "a different scene" gives back a different place. This says
 * neither.
 */
export const WORLD_CLAUSE =
  'The attached images are photographs of this same established world, made in the same place under the same light. ' +
  'This is another photograph of it, not a variation of any one of them: keep the place, its materials, its palette ' +
  'and the character of the light exactly as they show, do not repeat the composition of any attached image, and do ' +
  'not invent a different place.';

/** In every view of a figure-led world: the role travels, nobody's face does. */
export const FIGURE_VIEW_CLAUSE =
  'The same anonymous figure is in this view, playing the same role as in the attached images: nobody in particular, ' +
  'with no recognisable identity, and no likeness taken from any attached image.';

/**
 * What the set is read back with once it is complete. A revision, on purpose:
 * the analyzer keeps the record and rewrites only what several photographs of
 * one place can teach that one could not.
 */
export const CONSENSUS_NOTE =
  'These images are all photographs of the one world this record already describes, not new references. Keep the ' +
  'record; revise only prompt, lighting and camera so they describe what every image shares and, in one sentence, ' +
  'how the framing and distance vary between them.';

/**
 * The purposes, in the order they are drawn. Each says what its frame is for
 * and, where it must, disowns the wide framing by name: a close frame that
 * inherits "the whole layout" loses to it (the catalog's detail frames did,
 * six times in one batch).
 */
const VIEW_LADDER: { purpose: FramePurpose; clause: string; figureClause?: string }[] = [
  {
    purpose: 'wide',
    clause:
      'This view is the wide establishing photograph: step well back so the whole layout of the space reads from ' +
      'foreground through middle ground to background.',
  },
  {
    purpose: 'surface',
    clause:
      'This view is a close photograph of the surface where a subject would be placed: the material, its finish and ' +
      'how the light lands on it fill the frame. It steps in past the room, so the wide layout described above is not ' +
      'in this frame, only the surface and what immediately touches it.',
    figureClause:
      "This view is a close photograph of the figure's treatment and the surface around them: the material of the " +
      'treatment, its finish and how the light lands on it fill the frame; the wide layout described above is not in ' +
      'this frame.',
  },
  {
    purpose: 'angle',
    clause:
      'This view takes the same place from a different camera height and a different angle than any attached image: ' +
      'lower or higher, and turned to one side, so the space is seen the way none of them show it.',
  },
  {
    purpose: 'light',
    clause:
      'This view faces the other way from the main source of light: the same place with the light arriving from the ' +
      'opposite side of the frame, so what was lit is now in shade and what was in shade is lit.',
  },
  {
    purpose: 'zone',
    clause:
      'This view is of a second part of the same place: an adjacent area the attached images imply but do not show, ' +
      'dressed in the same materials, palette and light.',
  },
];

/** The purposes a set of this size draws, after its seed. */
export const viewLadder = (target: number): FramePurpose[] =>
  VIEW_LADDER.slice(0, Math.max(0, target - 1)).map((v) => v.purpose);

/** The seed's own prompt, then the world clause, then what this view is for. */
export function sceneViewPrompt(scene: CustomScene, purpose: FramePurpose): string {
  const view = VIEW_LADDER.find((v) => v.purpose === purpose);
  if (!view) return scenePreviewPrompt(scene);
  const clause = scene.figure && view.figureClause ? view.figureClause : view.clause;
  return `${scenePreviewPrompt(scene)} ${WORLD_CLAUSE} ${clause}${scene.figure ? ` ${FIGURE_VIEW_CLAUSE}` : ''}`;
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
    /** What this draw is for, for the debug line. */
    label?: string;
  },
): Promise<string> {
  const engine = deps.engine;
  if (!engine) throw new Error('no engine available');
  const engineId = engine.capabilities().id;
  deps.log?.(
    { engine: engineId, label: req.label ?? null, refs: req.referenceImages ?? [], roles: req.referenceRoles ?? [] },
    'asset draw',
  );
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
 * How many asset builds are unfinished: the update path refuses to restart
 * over one. A scene build waiting for its person counts, since a restart would
 * lose the board; the idle timeout bounds how long that can hold an update.
 */
export function runningAssetBuildCount(): number {
  let n = 0;
  for (const b of builds.values()) if (!b.finished) n++;
  return n;
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
