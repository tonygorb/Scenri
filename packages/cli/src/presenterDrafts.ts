/**
 * A presenter being cast, one approved view at a time.
 *
 * The rules this module exists for: an approved view is what the next view
 * is drawn from; regenerating a step never touches an approved one; redoing
 * an upstream view stales whatever was built on it; a failure keeps the
 * approved work; what is saved is exactly what was approved. The record is
 * a sqlite row (packages/core presenter_drafts) so a reload or a restart
 * resumes from it, and the one running step per draft lives in this module
 * with its own AbortController, the way asset builds do.
 *
 * Two sources, one flow. `synthetic` rolls an identity from a sentence and
 * locks it at portrait approval; `photos` starts from the user's own
 * photographs, which stay the truth: a photograph the analyzer files as a
 * usable view fills that slot as the original and is never redrawn, and
 * the rest are generated from the approved views plus the photographs.
 */
import { randomUUID } from 'node:crypto';
import type { Core } from '@scenri/core';
import type { PresenterDraft as AnalyzerDraft } from '@scenri/engine-codex';
import {
  LIKENESS_VERSION,
  brandCharacters,
  commit,
  presenterRecordFrom,
  type CustomPresenter,
  type LikenessConfirmation,
  type PresenterSource,
} from './assetRecords.js';
import { draw, presenterCrops, trimEdgeBars, type AssetBuildDeps } from './customAssets.js';
import {
  PRESENTER_VIEWS,
  studioPrompt,
  syntheticIdentitySubject,
  viewSubject,
  whoIs,
  type PresenterView,
} from './presenterPrompts.js';
import { presenterCropMode } from './presenterRepair.js';
import { capReferenceEdge } from './routes/shared.js';

export type ViewStatus = 'empty' | 'generating' | 'candidate' | 'approved' | 'stale';

export interface ViewSlot {
  status: ViewStatus;
  /** The current picture: a candidate awaiting a decision, or the approved view. */
  hash?: string;
  /**
   * The approved picture a revised candidate would replace. Kept until the
   * decision: Use retires it and stales what was drawn from it, Keep previous
   * puts it back.
   */
  prior?: string;
  /** Drawn by an engine, or one of the user's own photographs. */
  origin?: 'generated' | 'photo';
  /** Generations spent on this slot, failures included. */
  attempts: number;
  /** Generated pictures this slot has let go of. Removed on save or discard when nothing else holds them. */
  rejected: string[];
  /** The last adjustment applied, for the stage to show. */
  adjustment?: string;
  /** What the current picture was drawn from, in the order it was attached. */
  conditionedOn?: string[];
  /** Why the last attempt did not land. Cleared by the next one. */
  error?: string;
}

export interface PresenterDraftRecord {
  id: string;
  brandId: string;
  source: PresenterSource;
  /** The sentence a synthetic person is rolled from. Inert once the portrait is approved. */
  direction?: string;
  name: string;
  facets: string[];
  /** Recorded when the photographs are of a real person. Never on a synthetic one. */
  attestation?: LikenessConfirmation;
  /** The user's photographs, in the order they arrived. Never removed by a generation. */
  sources: string[];
  /** What the analyzer read: off the photographs, or off the approved portrait. */
  analysis?: AnalyzerDraft;
  /**
   * Why the photographs could not be read. The first photo then stands in as
   * the face, exactly as it does without an analyzer, and the rail says so.
   */
  readError?: string;
  views: Record<PresenterView, ViewSlot>;
  /** Generations spent on this draft, every slot, every attempt. */
  generations: number;
  /** The slot a step is drawing into, while one is. */
  activeView: PresenterView | null;
  stage: 'idle' | 'analyzing' | 'drawing';
  createdAt: string;
  updatedAt: string;
}

/** Which approved views a view is drawn from. The order is the attachment order. */
export const DEPENDS: Record<PresenterView, PresenterView[]> = {
  portrait: [],
  front: ['portrait'],
  left: ['portrait', 'front'],
  back: ['portrait', 'front'],
  right: ['portrait', 'front', 'left'],
};

/** How a view is named in a sentence a person reads. */
export const VIEW_LABEL: Record<PresenterView, string> = {
  portrait: 'face',
  front: 'front view',
  left: 'left view',
  back: 'back view',
  right: 'right view',
};

const isView = (v: unknown): v is PresenterView => (PRESENTER_VIEWS as readonly string[]).includes(String(v));
const HASH = /^[a-f0-9]{32}$/;
const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const str = (v: unknown, max: number) =>
  String(v ?? '')
    .trim()
    .slice(0, max);

/* ------------------------------------------------------------- persistence */

const emptySlot = (): ViewSlot => ({ status: 'empty', attempts: 0, rejected: [] });

function fromRow(row: { id: string; brandId: string; json: unknown; createdAt: string; updatedAt: string }) {
  const j = (row.json ?? {}) as Partial<PresenterDraftRecord>;
  const views = {} as Record<PresenterView, ViewSlot>;
  for (const v of PRESENTER_VIEWS) views[v] = { ...emptySlot(), ...(j.views?.[v] ?? {}) };
  const rec: PresenterDraftRecord = {
    id: row.id,
    brandId: row.brandId,
    source: j.source === 'synthetic' ? 'synthetic' : 'photos',
    name: String(j.name ?? ''),
    facets: Array.isArray(j.facets) ? j.facets.map(String) : [],
    sources: Array.isArray(j.sources) ? j.sources.map(String) : [],
    views,
    generations: Number(j.generations ?? 0),
    activeView: isView(j.activeView) ? j.activeView : null,
    stage: j.stage === 'analyzing' || j.stage === 'drawing' ? j.stage : 'idle',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (j.direction) rec.direction = String(j.direction);
  if (j.attestation) rec.attestation = j.attestation;
  if (j.analysis) rec.analysis = j.analysis;
  if (j.readError) rec.readError = String(j.readError);
  return rec;
}

function put(core: Core, rec: PresenterDraftRecord): PresenterDraftRecord {
  const { id, brandId, createdAt: _c, updatedAt: _u, ...json } = rec;
  return fromRow(core.store.putPresenterDraft({ id, brandId, json }));
}

/** Read fresh, change, write: never a read-modify-write across an await. */
function mutate(core: Core, id: string, fn: (rec: PresenterDraftRecord) => void): PresenterDraftRecord {
  const rec = getPresenterDraft(core, id);
  if (!rec) throw fail('draft not found', 404);
  fn(rec);
  return put(core, rec);
}

export function getPresenterDraft(core: Core, id: string): PresenterDraftRecord | null {
  const row = core.store.getPresenterDraft(id);
  return row ? fromRow(row) : null;
}

export function listPresenterDrafts(core: Core, brandId: string): PresenterDraftRecord[] {
  return core.store.listPresenterDrafts(brandId).map(fromRow);
}

/* ------------------------------------------------------------------ jobs */

const running = new Map<string, { view: PresenterView | null; ctrl: AbortController }>();

/** How many drafts are mid-step: the update path refuses to restart over one. */
export function runningDraftJobCount(): number {
  return running.size;
}

/** Test seam: the module-level registry outlives a test server otherwise. */
export function resetPresenterDrafts(): void {
  for (const job of running.values()) job.ctrl.abort();
  running.clear();
}

/**
 * After a restart, a slot the row says is generating has nothing behind it:
 * the process that was drawing it is gone. Put it back to what it was, with
 * the reason on it, the way the nodes table sweeps its running rows.
 */
export function sweepPresenterDrafts(core: Core): number {
  let swept = 0;
  for (const brand of core.store.listBrands()) {
    for (const rec of listPresenterDrafts(core, brand.id)) {
      const stuck = PRESENTER_VIEWS.filter((v) => rec.views[v].status === 'generating');
      if (!stuck.length && !rec.activeView && rec.stage === 'idle') continue;
      for (const v of stuck) {
        const slot = rec.views[v];
        slot.status = slot.hash ? 'candidate' : 'empty';
        slot.error = 'interrupted: server restarted mid-generation';
      }
      rec.activeView = null;
      rec.stage = 'idle';
      put(core, rec);
      swept += 1;
    }
  }
  return swept;
}

/* ---------------------------------------------------------------- create */

export interface CreateDraftInput {
  brandId: string;
  source: PresenterSource;
  direction?: string;
  imageHashes?: string[];
  /** The likeness confirmation, given. Required for photographs of a real person. */
  attestation?: boolean;
  name?: string;
  facets?: string[];
}

export async function createPresenterDraft(
  deps: AssetBuildDeps,
  input: CreateDraftInput,
): Promise<PresenterDraftRecord> {
  const { core } = deps;
  const brand = core.store.getBrand(input.brandId);
  if (!brand) throw fail('brand not found', 404);
  const source: PresenterSource = input.source === 'synthetic' ? 'synthetic' : 'photos';
  const direction = str(input.direction, 400);
  const sources = (input.imageHashes ?? []).map(String).filter((h) => HASH.test(h) && core.images.has(h));
  if (source === 'synthetic' && !direction) throw fail('describe who they are in a sentence', 400);
  // A person from a description is nothing but what an engine draws.
  if (source === 'synthetic' && !deps.engine) throw fail('no engine here can draw a person', 400);
  if (source === 'photos' && !sources.length) throw fail('add at least one photo of this person', 400);
  if (source === 'photos' && !input.attestation) {
    throw fail("confirm you have permission to use this person's likeness", 400);
  }
  const views = {} as Record<PresenterView, ViewSlot>;
  for (const v of PRESENTER_VIEWS) views[v] = emptySlot();
  const rec: PresenterDraftRecord = {
    id: `pd-${randomUUID().slice(0, 8)}`,
    brandId: brand.id,
    source,
    name: str(input.name, 60),
    facets: (input.facets ?? [])
      .map((f) => str(f, 40))
      .filter(Boolean)
      .slice(0, 8),
    sources: source === 'photos' ? sources : [],
    views,
    generations: 0,
    activeView: null,
    stage: 'idle',
    createdAt: '',
    updatedAt: '',
  };
  if (source === 'synthetic') rec.direction = direction;
  else {
    rec.attestation = { attestedAt: new Date().toISOString(), version: LIKENESS_VERSION };
    if (direction) rec.direction = direction;
  }
  const saved = put(core, rec);
  if (source === 'photos') startJob(deps, saved.id, null, (signal) => filePhotos(deps, saved.id, signal));
  return saved;
}

/**
 * Read the photographs once, and let the ones that already are a canonical
 * view fill that slot as the original. Without an analyzer the first photo
 * is the portrait: the face the user chose to lead with. A read that fails
 * (the engine's limit, a dropped connection) lands the same way, with the
 * reason on the row, so the draft never sits empty and silent.
 */
async function filePhotos(deps: AssetBuildDeps, id: string, signal: AbortSignal): Promise<void> {
  const { core, analyzer } = deps;
  const rec = getPresenterDraft(core, id);
  if (!rec) return;
  let analysis: AnalyzerDraft | undefined;
  let readError: string | undefined;
  if (analyzer) {
    mutate(core, id, (r) => {
      r.stage = 'analyzing';
    });
    try {
      analysis = (await analyzer.analyze(
        {
          kind: 'presenter',
          imagePaths: rec.sources.map((h) => core.images.pathFor(h)),
          name: rec.name || 'New presenter',
          instruction: rec.direction || undefined,
          vocabulary: deps.vocabulary,
          classifyPhotos: true,
        },
        signal,
      )) as AnalyzerDraft;
    } catch (err: any) {
      if (signal.aborted) return;
      readError = String(err?.message ?? 'the photos could not be read');
    }
  }
  if (signal.aborted) return;
  mutate(core, id, (r) => {
    if (analysis) r.analysis = analysis;
    r.readError = readError;
    const filings = analysis?.photos ?? [];
    for (const v of PRESENTER_VIEWS) {
      const hit = filings.find((p) => p.view === v && p.usable && r.sources[p.index]);
      if (hit) r.views[v] = { ...emptySlot(), status: 'approved', hash: r.sources[hit.index], origin: 'photo' };
    }
    if (!analysis && r.views.portrait.status === 'empty') {
      r.views.portrait = { ...emptySlot(), status: 'approved', hash: r.sources[0], origin: 'photo' };
    }
  });
}

function startJob(
  deps: AssetBuildDeps,
  id: string,
  view: PresenterView | null,
  work: (signal: AbortSignal) => Promise<void>,
): void {
  const ctrl = new AbortController();
  running.set(id, { view, ctrl });
  void work(ctrl.signal)
    .catch(() => {
      // every job writes its own outcome onto the row; nothing escapes here
    })
    .finally(() => {
      running.delete(id);
      try {
        mutate(deps.core, id, (r) => {
          r.activeView = null;
          r.stage = 'idle';
        });
      } catch {
        // the draft was discarded while the job ran
      }
    });
}

/* -------------------------------------------------------------- generate */

/**
 * Draw one view, from the approved views it depends on plus the photographs,
 * and land it as this slot's candidate. The step before it stays exactly as
 * it was, whatever happens here.
 */
export async function generateView(
  deps: AssetBuildDeps,
  id: string,
  view: PresenterView,
  opts: { adjustment?: string } = {},
): Promise<{ draft: PresenterDraftRecord }> {
  const { core, engine } = deps;
  if (!isView(view)) throw fail('no such view', 400);
  const rec = getPresenterDraft(core, id);
  if (!rec) throw fail('draft not found', 404);
  if (running.has(id)) throw fail('a view is still being drawn', 409);
  for (const dep of DEPENDS[view]) {
    if (rec.views[dep].status !== 'approved') throw fail(`approve the ${VIEW_LABEL[dep]} first`, 400);
  }
  if (!engine || !engine.capabilities().maxReferenceImages) throw fail('no engine here can draw a person', 400);
  const adjustment = str(opts.adjustment, 240) || undefined;
  const before = rec.views[view].status;
  const saved = mutate(core, id, (r) => {
    r.views[view].status = 'generating';
    r.views[view].error = undefined;
    r.activeView = view;
    r.stage = 'drawing';
  });
  startJob(deps, id, view, (signal) => drawView(deps, id, view, before, adjustment, signal));
  return { draft: saved };
}

async function drawView(
  deps: AssetBuildDeps,
  id: string,
  view: PresenterView,
  before: ViewStatus,
  adjustment: string | undefined,
  signal: AbortSignal,
): Promise<void> {
  const { core, engine, analyzer } = deps;
  const caps = engine!.capabilities();
  let rec = getPresenterDraft(core, id)!;
  try {
    // The words that name the person, read off the approved portrait once.
    // Folded into the first step after the lock so approving is instant.
    if (!rec.analysis && analyzer && view !== 'portrait' && rec.views.portrait.hash) {
      mutate(core, id, (r) => {
        r.stage = 'analyzing';
      });
      const analysis = (await analyzer.analyze(
        {
          kind: 'presenter',
          imagePaths: [core.images.pathFor(rec.views.portrait.hash)],
          name: rec.name || 'New presenter',
          instruction: rec.direction || undefined,
          vocabulary: deps.vocabulary,
        },
        signal,
      )) as AnalyzerDraft;
      rec = mutate(core, id, (r) => {
        r.analysis = analysis;
        r.stage = 'drawing';
      });
    }
    if (signal.aborted) throw new Error('cancelled');

    const { prompt, refs } = planStep(rec, view, adjustment, caps.maxReferenceImages);
    const paths: string[] = [];
    for (const h of refs) {
      const p = core.images.pathFor(h);
      paths.push(caps.maxReferenceEdge ? await capReferenceEdge(core, p, caps.maxReferenceEdge) : p);
    }
    const drawn = await draw(deps, {
      prompt,
      brandId: rec.brandId,
      ...(paths.length ? { referenceImages: paths, referenceRoles: paths.map(() => 'character' as const) } : {}),
      signal,
    });
    // Before anything chains off it: a bar left on the anchor is a bar the
    // next view is conditioned on and faithfully reproduces.
    const hash = await trimEdgeBars(core, drawn);
    mutate(core, id, (r) => {
      const slot = r.views[view];
      if (slot.hash && slot.hash !== hash) {
        // A revision of an approved view keeps the approved picture until the
        // decision; a candidate being redrawn is simply let go of.
        if (before === 'approved') slot.prior = slot.hash;
        else if (slot.origin === 'generated') slot.rejected = [...slot.rejected, slot.hash];
      }
      slot.status = 'candidate';
      slot.hash = hash;
      slot.origin = 'generated';
      slot.attempts += 1;
      slot.conditionedOn = refs;
      slot.adjustment = adjustment;
      slot.error = undefined;
      r.generations += 1;
    });
  } catch (err: any) {
    mutate(core, id, (r) => {
      const slot = r.views[view];
      slot.status = before === 'generating' ? (slot.hash ? 'candidate' : 'empty') : before;
      slot.attempts += 1;
      slot.error = signal.aborted ? 'cancelled' : String(err?.message ?? 'the view could not be drawn');
      r.generations += 1;
    });
  }
}

/** What a step is drawn from and asked for. Pure, so the choice is testable and the manifest honest. */
export function planStep(
  rec: PresenterDraftRecord,
  view: PresenterView,
  adjustment: string | undefined,
  cap: number,
): { prompt: string; refs: string[] } {
  const slot = rec.views[view];
  // The identity roll: nothing to condition on but the sentence, unless the
  // person is being nudged, in which case the candidate rides so a nudge
  // keeps the person and a new roll does not.
  if (rec.source === 'synthetic' && view === 'portrait') {
    const nudge = adjustment && slot.hash ? [slot.hash] : [];
    return {
      prompt: studioPrompt(
        syntheticIdentitySubject(rec.direction ?? '', { adjustment: nudge.length ? adjustment : undefined }),
      ),
      refs: nudge,
    };
  }
  // Approved views first, in dependency order, then the photographs the
  // draft started from, inside the engine's budget.
  const refs: string[] = [];
  for (const dep of DEPENDS[view]) {
    const h = rec.views[dep].hash;
    if (h && rec.views[dep].status === 'approved' && !refs.includes(h)) refs.push(h);
  }
  for (const h of rec.sources) if (!refs.includes(h)) refs.push(h);
  const who = whoIs(rec.name || 'this person', rec.analysis ?? null);
  const subject = adjustment
    ? `${viewSubject(view, who)}, and for this view only: ${adjustment}`
    : viewSubject(view, who);
  return { prompt: studioPrompt(subject), refs: refs.slice(0, Math.max(1, cap)) };
}

/* ---------------------------------------------------------------- decide */

/** This is the person, or this is the view: from here on it is what the next view is drawn from. */
export async function approveView(
  deps: AssetBuildDeps,
  id: string,
  view: PresenterView,
): Promise<PresenterDraftRecord> {
  if (!isView(view)) throw fail('no such view', 400);
  const rec = getPresenterDraft(deps.core, id);
  if (!rec) throw fail('draft not found', 404);
  const slot = rec.views[view];
  if (slot.status === 'approved') return rec;
  if (slot.status === 'stale') throw fail(`redo the ${VIEW_LABEL[view]}: it was built on a view you changed`, 400);
  if (slot.status !== 'candidate' || !slot.hash) throw fail(`there is no ${VIEW_LABEL[view]} to approve yet`, 400);
  return mutate(deps.core, id, (r) => {
    const s = r.views[view];
    s.status = 'approved';
    if (s.prior) {
      // A revision took an approved picture's place: whatever was drawn from
      // the old one no longer stands, and is drawn again from this one.
      if (!r.sources.includes(s.prior)) s.rejected = [...s.rejected, s.prior];
      s.prior = undefined;
      staleDependents(r, view);
    }
  });
}

/** Keep the approved picture: the revision goes, and nothing built on the approved one moves. */
export async function revertView(deps: AssetBuildDeps, id: string, view: PresenterView): Promise<PresenterDraftRecord> {
  if (!isView(view)) throw fail('no such view', 400);
  if (running.has(id)) throw fail('a view is still being drawn', 409);
  const rec = getPresenterDraft(deps.core, id);
  if (!rec) throw fail('draft not found', 404);
  if (!rec.views[view].prior) throw fail(`there is no previous ${VIEW_LABEL[view]} to keep`, 400);
  return mutate(deps.core, id, (r) => {
    const s = r.views[view];
    const prior = s.prior as string;
    if (s.hash && s.hash !== prior && !r.sources.includes(s.hash)) s.rejected = [...s.rejected, s.hash];
    s.hash = prior;
    s.origin = r.sources.includes(prior) ? 'photo' : 'generated';
    s.status = 'approved';
    s.prior = undefined;
    s.adjustment = undefined;
    s.conditionedOn = undefined;
    s.error = undefined;
  });
}

/** Every view drawn from this one, transitively. */
function dependents(view: PresenterView): PresenterView[] {
  return PRESENTER_VIEWS.filter((v) => v !== view && reaches(v, view));
}
function reaches(from: PresenterView, to: PresenterView): boolean {
  return DEPENDS[from].some((d) => d === to || reaches(d, to));
}

function staleDependents(r: PresenterDraftRecord, view: PresenterView): void {
  for (const d of dependents(view)) {
    const s = r.views[d];
    // A photograph is the truth whatever was drawn upstream of it.
    if (s.origin === 'photo') continue;
    if (s.status === 'approved' || s.status === 'candidate') s.status = 'stale';
  }
}

/**
 * Take a view back to empty. Whatever was built on it is marked stale and has
 * to be drawn again, because it was conditioned on a picture that no longer
 * stands. Rolling a synthetic portrait again is a new person, so the words
 * read off the old face go with it.
 */
export async function redoView(deps: AssetBuildDeps, id: string, view: PresenterView): Promise<PresenterDraftRecord> {
  if (!isView(view)) throw fail('no such view', 400);
  if (running.has(id)) throw fail('a view is still being drawn', 409);
  return mutate(deps.core, id, (r) => {
    const slot = r.views[view];
    const gone = [slot.hash, slot.prior].filter((h): h is string => !!h && !r.sources.includes(h));
    r.views[view] = { ...emptySlot(), attempts: slot.attempts, rejected: [...slot.rejected, ...gone] };
    staleDependents(r, view);
    if (view === 'portrait' && r.source === 'synthetic') r.analysis = undefined;
  });
}

/** One of the user's own photographs, put in a slot by hand. The original is the truth; nothing is drawn. */
export async function usePhotoForView(
  deps: AssetBuildDeps,
  id: string,
  view: PresenterView,
  hash: string,
): Promise<PresenterDraftRecord> {
  if (!isView(view)) throw fail('no such view', 400);
  if (running.has(id)) throw fail('a view is still being drawn', 409);
  const rec = getPresenterDraft(deps.core, id);
  if (!rec) throw fail('draft not found', 404);
  if (rec.source !== 'photos' || !rec.sources.includes(hash)) throw fail('that is not one of their photos', 400);
  return mutate(deps.core, id, (r) => {
    const slot = r.views[view];
    if (slot.hash === hash && slot.origin === 'photo') return;
    const gone = [slot.hash, slot.prior].filter((h): h is string => !!h && !r.sources.includes(h));
    r.views[view] = {
      ...emptySlot(),
      attempts: slot.attempts,
      rejected: [...slot.rejected, ...gone],
      status: 'approved',
      hash,
      origin: 'photo',
    };
    staleDependents(r, view);
  });
}

/** The words around the person. None of these touch a view. */
export async function updatePresenterDraft(
  core: Core,
  id: string,
  patch: { name?: unknown; facets?: unknown; direction?: unknown },
): Promise<PresenterDraftRecord> {
  return mutate(core, id, (r) => {
    if (patch.name !== undefined) r.name = str(patch.name, 60);
    if (Array.isArray(patch.facets))
      r.facets = patch.facets
        .map((f) => str(f, 40))
        .filter(Boolean)
        .slice(0, 8);
    if (patch.direction !== undefined) r.direction = str(patch.direction, 400) || undefined;
  });
}

/* ------------------------------------------------------------------ save */

export interface CleanupHooks {
  /** Drop the derivatives of an image that is being removed. */
  evict?: (hash: string) => void;
}

/**
 * Commit the approved views as a presenter, exactly as approved: the portrait
 * leads, the card and avatar are crops of it, the photographs stay as the
 * evidence. Then the draft goes, and with it every rejected picture nothing
 * else holds.
 */
export async function savePresenterDraft(
  deps: AssetBuildDeps,
  id: string,
  hooks: CleanupHooks = {},
): Promise<{ presenter: CustomPresenter; brand: ReturnType<Core['store']['getBrand']> }> {
  const { core } = deps;
  const rec = getPresenterDraft(core, id);
  if (!rec) throw fail('draft not found', 404);
  if (running.has(id)) throw fail('a view is still being drawn', 409);
  if (!rec.name.trim()) throw fail('give them a name', 400);
  // Without an engine the photographs are the presenter: the portrait leads
  // and the rest follow as they are. Fewer views than a drawn set has, but a
  // working person rather than a blocked flow, exactly the old build's
  // fallback.
  const blind = !deps.engine;
  const required: PresenterView[] = blind ? ['portrait'] : [...PRESENTER_VIEWS];
  for (const v of required) {
    const s = rec.views[v];
    if (s.status === 'stale') throw fail(`redo the ${VIEW_LABEL[v]}: it was built on a view you changed`, 400);
    if (s.status !== 'approved' || !s.hash) throw fail(`approve the ${VIEW_LABEL[v]} first`, 400);
  }
  const approved = required.map((v) => rec.views[v].hash as string);
  const shots = blind ? [...approved, ...rec.sources.filter((h) => !approved.includes(h))] : approved;
  const angles = blind ? ['portrait'] : [...PRESENTER_VIEWS];
  const portraitFile = `asset:${shots[0]}`;
  const sourceFiles = rec.sources.map((h) => `asset:${h}`);
  const mode = presenterCropMode(portraitFile, sourceFiles, 'portrait');
  const { previewHash, avatarHash } = await presenterCrops(core, shots[0], mode);
  const a = rec.analysis;
  const built = presenterRecordFrom({
    name: rec.name,
    shotHashes: shots,
    shotAngles: angles,
    ...(rec.sources.length ? { sourceHashes: rec.sources } : {}),
    previewHash,
    avatarHash,
    promptName: a?.promptName ?? (rec.source === 'synthetic' ? rec.direction : undefined),
    presentation: a?.presentation,
    descriptor: a?.descriptor,
    ageRange: a?.ageRange,
    hair: a?.hair,
    identityNotes: a?.identityNotes,
    negativeConstraints: a?.negativeConstraints,
    // What the person filing this chose wins over what the analyzer guessed.
    suitableCategories: rec.facets.length ? rec.facets : a?.suitableCategories,
    facial: a?.facial,
    skin: a?.skin,
    build: a?.build,
    source: rec.source,
    ...(rec.source === 'photos' && rec.attestation ? { likeness: rec.attestation } : {}),
  });
  if (!built.ok) throw fail(built.error, 400);
  commit(core, rec.brandId, (json) => {
    json.characters = [...brandCharacters(json), built.presenter];
  });
  core.store.deletePresenterDraft(id);
  removeUnreferenced(
    core,
    PRESENTER_VIEWS.flatMap((v) => rec.views[v].rejected),
    hooks,
  );
  return { presenter: built.presenter, brand: core.store.getBrand(rec.brandId) };
}

/** Intentional cancel: the row goes, and every picture this draft alone was holding. */
export async function discardPresenterDraft(deps: AssetBuildDeps, id: string, hooks: CleanupHooks = {}): Promise<void> {
  running.get(id)?.ctrl.abort();
  running.delete(id);
  const rec = getPresenterDraft(deps.core, id);
  if (!rec) return;
  dropDraft(deps.core, rec, hooks);
}

/** Fourteen days untouched is abandoned. */
export const ABANDONED_DRAFT_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * At boot, let go of drafts nobody has touched in two weeks, the way a
 * discard would: the row, and every picture the draft alone was holding. A
 * draft closed and forgotten used to keep every rejected candidate forever.
 */
export function sweepAbandonedPresenterDrafts(core: Core, hooks: CleanupHooks = {}, now = Date.now()): number {
  let swept = 0;
  for (const brand of core.store.listBrands()) {
    for (const rec of listPresenterDrafts(core, brand.id)) {
      if (running.has(rec.id)) continue;
      const touched = stampMs(rec.updatedAt);
      if (Number.isNaN(touched) || now - touched < ABANDONED_DRAFT_MS) continue;
      dropDraft(core, rec, hooks);
      swept += 1;
    }
  }
  return swept;
}

/** The store stamps rows as UTC `YYYY-MM-DD HH:MM:SS[.mmm]`; read that, or any ISO string. */
function stampMs(s: string): number {
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  return Date.parse(/Z$|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
}

function dropDraft(core: Core, rec: PresenterDraftRecord, hooks: CleanupHooks): void {
  core.store.deletePresenterDraft(rec.id);
  const generated = PRESENTER_VIEWS.flatMap((v) => {
    const s = rec.views[v];
    return [...s.rejected, ...(s.hash && s.origin === 'generated' ? [s.hash] : []), ...(s.prior ? [s.prior] : [])];
  });
  removeUnreferenced(core, [...generated, ...rec.sources], hooks);
}

/**
 * Remove stored images nothing points at any more: no shot, no brief, no
 * catalog image, no other draft, no brand document. The store is
 * content-addressed, so the same bytes in two places are one file, and one
 * owner is enough to keep it.
 */
function removeUnreferenced(core: Core, hashes: string[], hooks: CleanupHooks): void {
  const brands = core.store.listBrands().map((b) => JSON.stringify(b.json));
  for (const h of new Set(hashes)) {
    if (!HASH.test(h)) continue;
    if (core.store.imageReferenced(h)) continue;
    if (brands.some((b) => b.includes(h))) continue;
    if (core.images.remove(h)) hooks.evict?.(h);
  }
}
