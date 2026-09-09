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
import { existsSync } from 'node:fs';
import type { Core } from '@scenri/core';
import type { PresenterDraft as AnalyzerDraft } from '@scenri/engine-codex';
import {
  IDENTITY_EDIT_CHARS,
  IDENTITY_EDITS_MAX,
  LIKENESS_VERSION,
  brandCharacters,
  commit,
  headOf,
  identityEditsOf,
  isCustomPresenter,
  mintRevision,
  presenterRecordFrom,
  type CustomPresenter,
  type CustomShot,
  type LikenessConfirmation,
  type PresenterInput,
  type PresenterSource,
} from './assetRecords.js';
import { draw, presenterCrops, trimEdgeBars, type AssetBuildDeps } from './customAssets.js';
import {
  ATTACHED_PERSON,
  CORE_VIEWS,
  EXTRA_VIEWS,
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

/** One sentence sent to redraw a view. The conversation is read off these, in the order they were sent. */
export interface DraftAsk {
  view: PresenterView;
  text: string;
  at: string;
}

/** Asks a draft keeps: enough for a long session, the oldest let go first. */
const ASKS_MAX = 40;

/**
 * A picture that landed on a view: drawn, from an ask or on its own, or
 * restored from before. Every one is a restore point while the draft lives:
 * its file is kept until the draft is saved or discarded.
 */
export interface DraftResult {
  view: PresenterView;
  hash: string;
  at: string;
  /** The sentence it was drawn from, when there was one. */
  ask?: string;
  how: 'drawn' | 'restored';
}

/** A decision taken on a view: the candidate used, tried again, or the previous kept. */
export interface DraftDecision {
  view: PresenterView;
  what: 'use' | 'again' | 'keep';
  at: string;
}

const RESULTS_MAX = 60;

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
  /**
   * Whether the extra views (back, left, right) may be drawn. Off until asked
   * for: a view costs minutes of engine time and a brief carries the three
   * core views. An extra already drawn is kept and saved whatever this says.
   */
  extras: boolean;
  /** Generations spent on this draft, every slot, every attempt. */
  generations: number;
  /** The slot a step is drawing into, while one is. */
  activeView: PresenterView | null;
  stage: 'idle' | 'analyzing' | 'drawing';
  /** The presenter this session edits, the head when it was opened. Absent on a creation. */
  presenterId?: string;
  /** The head's id when the session was seeded; a save refuses when the head has moved since. */
  baseId?: string;
  /** Identity-wide instructions accepted in this session, on top of the record's own. Newest last. */
  identityEdits: string[];
  /**
   * Every sentence sent to redraw a view, oldest first. A slot holds only its
   * last adjustment; this is the exchange as it happened, so the conversation
   * shows each ask under the line it answered and none is rewritten by the next.
   */
  asks: DraftAsk[];
  /** Every picture that landed on a view, oldest first: the record's restore points. */
  results: DraftResult[];
  /** Every decision taken on a view, oldest first. */
  decisions: DraftDecision[];
  /** Shots the record holds under an angle the studio has no slot for. Written back untouched, after the six views. */
  keptShots?: CustomShot[];
  createdAt: string;
  updatedAt: string;
}

/** Which approved views a view is drawn from. The order is the attachment order. */
export const DEPENDS: Record<PresenterView, PresenterView[]> = {
  portrait: [],
  front: ['portrait'],
  'three-quarter': ['portrait', 'front'],
  back: ['portrait', 'front'],
  left: ['portrait', 'front'],
  right: ['portrait', 'front', 'left'],
};

/** How a view is named in a sentence a person reads. */
export const VIEW_LABEL: Record<PresenterView, string> = {
  portrait: 'face',
  front: 'front view',
  'three-quarter': 'three-quarter view',
  back: 'back view',
  left: 'left view',
  right: 'right view',
};

const isView = (v: unknown): v is PresenterView => (PRESENTER_VIEWS as readonly string[]).includes(String(v));
const isExtra = (v: PresenterView) => EXTRA_VIEWS.includes(v);
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
    extras: j.extras === true,
    generations: Number(j.generations ?? 0),
    activeView: isView(j.activeView) ? j.activeView : null,
    stage: j.stage === 'analyzing' || j.stage === 'drawing' ? j.stage : 'idle',
    identityEdits: identityEditsOf(j.identityEdits),
    asks: asksOf(j.asks),
    results: resultsOf(j.results),
    decisions: decisionsOf(j.decisions),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (j.direction) rec.direction = String(j.direction);
  if (j.attestation) rec.attestation = j.attestation;
  if (j.analysis) rec.analysis = j.analysis;
  if (j.readError) rec.readError = String(j.readError);
  if (j.presenterId) rec.presenterId = String(j.presenterId);
  if (j.baseId) rec.baseId = String(j.baseId);
  if (Array.isArray(j.keptShots) && j.keptShots.length) rec.keptShots = j.keptShots.map(shotOf);
  return rec;
}

const asksOf = (v: unknown): DraftAsk[] =>
  (Array.isArray(v) ? v : [])
    .filter((a: any) => isView(a?.view) && typeof a?.text === 'string' && a.text.trim())
    .map((a: any) => ({ view: a.view as PresenterView, text: String(a.text), at: String(a.at ?? '') }))
    .slice(-ASKS_MAX);

const resultsOf = (v: unknown): DraftResult[] =>
  (Array.isArray(v) ? v : [])
    .filter((r: any) => isView(r?.view) && HASH.test(String(r?.hash ?? '')))
    .map((r: any) => ({
      view: r.view as PresenterView,
      hash: String(r.hash),
      at: String(r.at ?? ''),
      ...(typeof r.ask === 'string' && r.ask ? { ask: String(r.ask) } : {}),
      how: r.how === 'restored' ? ('restored' as const) : ('drawn' as const),
    }))
    .slice(-RESULTS_MAX);

const decisionsOf = (v: unknown): DraftDecision[] =>
  (Array.isArray(v) ? v : [])
    .filter((d: any) => isView(d?.view) && ['use', 'again', 'keep'].includes(d?.what))
    .map((d: any) => ({ view: d.view as PresenterView, what: d.what as DraftDecision['what'], at: String(d.at ?? '') }))
    .slice(-RESULTS_MAX);

const shotOf = (s: any): CustomShot => ({
  file: String(s?.file ?? ''),
  ...(s?.angle ? { angle: String(s.angle) } : {}),
  ...(s?.locked ? { locked: true } : {}),
});

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
  /** Ask for the extra views from the start. */
  extras?: boolean;
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
    extras: input.extras === true,
    generations: 0,
    activeView: null,
    stage: 'idle',
    identityEdits: [],
    asks: [],
    results: [],
    decisions: [],
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

/* ------------------------------------------------------------------ edit */

const hashOfFile = (file: unknown): string | null => {
  const s = String(file ?? '');
  return s.startsWith('asset:') && HASH.test(s.slice(6)) ? s.slice(6) : null;
};

/** The record's own words, cut the way the session's direction is seeded from them, so an unchanged direction compares equal. */
const seedDirection = (p: CustomPresenter) => str(p.identityNotes ?? p.descriptor, 400);

/**
 * A record's shots as the six slots, plus whatever it holds under an angle
 * the studio has no slot for. One compatibility boundary for every record
 * shape: a studio build fills its views by angle; a record with no portrait
 * leads with its first shot, which is what its card and avatar were cropped
 * from; a shot that is one of `sourceRefs` is the user's own photograph and
 * is never redrawn.
 */
function slotsFromRecord(presenter: CustomPresenter): {
  views: Record<PresenterView, ViewSlot>;
  kept: CustomShot[];
  sources: string[];
} {
  const sources = (presenter.sourceRefs ?? []).map((s) => hashOfFile(s.file)).filter((h): h is string => !!h);
  const views = {} as Record<PresenterView, ViewSlot>;
  for (const v of PRESENTER_VIEWS) views[v] = emptySlot();
  const kept: CustomShot[] = [];
  const shots = presenter.shots ?? [];
  const hasPortrait = shots.some((s) => s.angle === 'portrait' && hashOfFile(s.file));
  shots.forEach((shot, i) => {
    const hash = hashOfFile(shot.file);
    const angle = !hasPortrait && i === 0 ? 'portrait' : shot.angle;
    if (hash && isView(angle) && views[angle].status === 'empty') {
      const origin = sources.includes(hash) ? 'photo' : 'generated';
      views[angle] = { ...emptySlot(), status: 'approved', hash, origin };
    } else kept.push({ ...shot });
  });
  return { views, kept, sources };
}

/**
 * Open a saved person for editing: a draft seeded from the record, every
 * view it holds approved as it is, nothing drawn and nothing read. What the
 * session changes lands on the draft; the record changes only on save.
 */
export function seedDraftFromPresenter(core: Core, brandId: string, presenter: CustomPresenter): PresenterDraftRecord {
  const { views, kept, sources } = slotsFromRecord(presenter);
  const source: PresenterSource = presenter.source ?? (presenter.sourceRefs?.length ? 'photos' : 'synthetic');
  const direction = seedDirection(presenter);
  const rec: PresenterDraftRecord = {
    id: `pd-${randomUUID().slice(0, 8)}`,
    brandId,
    source,
    name: str(presenter.name, 60),
    facets: (presenter.suitableCategories ?? [])
      .map((f) => str(f, 40))
      .filter(Boolean)
      .slice(0, 8),
    sources,
    views,
    extras: EXTRA_VIEWS.some((v) => views[v].status !== 'empty'),
    generations: 0,
    activeView: null,
    stage: 'idle',
    presenterId: presenter.id,
    baseId: presenter.id,
    identityEdits: identityEditsOf(presenter.identityEdits),
    asks: [],
    results: [],
    decisions: [],
    createdAt: '',
    updatedAt: '',
  };
  if (direction) rec.direction = direction;
  if (presenter.likeness) rec.attestation = presenter.likeness;
  if (kept.length) rec.keptShots = kept;
  return put(core, rec);
}

/**
 * The session for a saved person: the one already open on them, else a
 * fresh seed. Any id in their history opens the head, so a link from an old
 * shot still edits the current record.
 */
export function openPresenterEdit(core: Core, brandId: string, presenterId: string): PresenterDraftRecord {
  const brand = core.store.getBrand(brandId);
  if (!brand) throw fail('brand not found', 404);
  const rows = brandCharacters(brand.json);
  const asked = rows.find((c) => c?.id === presenterId);
  if (!asked) throw fail('presenter not found', 404);
  if (!isCustomPresenter(asked)) throw fail('this presenter is not editable', 400);
  const headId = headOf(brand.json, presenterId);
  const head = rows.find((c) => c?.id === headId) as CustomPresenter;
  return (
    listPresenterDrafts(core, brandId).find((d) => d.presenterId === headId) ??
    seedDraftFromPresenter(core, brandId, head)
  );
}

/**
 * The words an identity edit is about, so a later edit about the same
 * thing replaces the earlier one instead of contradicting it. A short list
 * and a word-boundary match, on purpose: the first of these in the sentence
 * names the trait, and a sentence the list does not know is a note of its
 * own.
 */
export const IDENTITY_WORDS: readonly string[] = [
  'hair',
  'fringe',
  'bangs',
  'curls',
  'beard',
  'moustache',
  'mustache',
  'stubble',
  'eyebrows',
  'eyebrow',
  'brows',
  'brow',
  'eyes',
  'eye',
  'lashes',
  'nose',
  'lips',
  'mouth',
  'teeth',
  'smile',
  'chin',
  'jawline',
  'jaw',
  'cheekbones',
  'cheeks',
  'ears',
  'neck',
  'skin',
  'freckles',
  'scar',
  'mole',
  'tattoo',
  'wrinkles',
  'glasses',
  'earrings',
  'earring',
  'piercing',
  'makeup',
  'age',
  'older',
  'younger',
  'build',
  'weight',
  'height',
  'shoulders',
];
const TRAIT_ALIAS: Record<string, string> = {
  fringe: 'hair',
  bangs: 'hair',
  curls: 'hair',
  mustache: 'moustache',
  stubble: 'beard',
  eyebrow: 'brow',
  eyebrows: 'brow',
  brows: 'brow',
  eye: 'eyes',
  lashes: 'eyes',
  jawline: 'jaw',
  cheeks: 'cheekbones',
  earring: 'earrings',
  older: 'age',
  younger: 'age',
  weight: 'build',
  height: 'build',
};
const TRAIT = new RegExp(`\\b(${IDENTITY_WORDS.join('|')})\\b`, 'i');

/** The trait an edit names, by its first identity word; null when it names none. */
export function traitOf(sentence: string): string | null {
  const m = TRAIT.exec(sentence);
  if (!m) return null;
  const word = m[1].toLowerCase();
  return TRAIT_ALIAS[word] ?? word;
}

/**
 * An accepted identity edit joins the list, replacing an earlier entry about
 * the same trait, so "much longer hair" after "shorter hair" leaves one
 * instruction about hair. Newest last, eight at most, the oldest let go.
 */
export function mergeIdentityEdits(existing: string[], adjustment: string): string[] {
  const next = str(adjustment, IDENTITY_EDIT_CHARS).replace(/\s+/g, ' ');
  if (!next) return existing.slice(-IDENTITY_EDITS_MAX);
  const trait = traitOf(next);
  const kept = existing.filter((e) => e.toLowerCase() !== next.toLowerCase() && (!trait || traitOf(e) !== trait));
  return [...kept, next].slice(-IDENTITY_EDITS_MAX);
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
 *
 * With `decide: 'auto'` the view lands approved instead of waiting for Use,
 * keeping the picture it replaced as `prior` so Keep previous still works.
 * Never the face: the identity is always judged by a person.
 */
export async function generateView(
  deps: AssetBuildDeps,
  id: string,
  view: PresenterView,
  opts: { adjustment?: string; decide?: 'auto' } = {},
): Promise<{ draft: PresenterDraftRecord }> {
  const { core, engine } = deps;
  if (!isView(view)) throw fail('no such view', 400);
  const rec = getPresenterDraft(core, id);
  if (!rec) throw fail('draft not found', 404);
  if (running.has(id)) throw fail('a view is still being drawn', 409);
  if (isExtra(view) && !rec.extras) throw fail('extra views are built on request', 400);
  if (opts.decide === 'auto' && view === 'portrait') throw fail('the face is always decided by hand', 400);
  for (const dep of DEPENDS[view]) {
    if (rec.views[dep].status !== 'approved') throw fail(`approve the ${VIEW_LABEL[dep]} first`, 400);
  }
  if (!engine || !engine.capabilities().maxReferenceImages) throw fail('no engine here can draw a person', 400);
  const adjustment = str(opts.adjustment, 240) || undefined;
  const decide = opts.decide === 'auto' ? 'auto' : undefined;
  const before = rec.views[view].status;
  const saved = mutate(core, id, (r) => {
    r.views[view].status = 'generating';
    r.views[view].error = undefined;
    r.activeView = view;
    r.stage = 'drawing';
    // The sentence joins the record once: the same one sent to the same view
    // again is Try again, not a second ask.
    const last = r.asks[r.asks.length - 1];
    if (adjustment && !(last && last.view === view && last.text === adjustment)) {
      r.asks = [...r.asks, { view, text: adjustment, at: new Date().toISOString() }].slice(-ASKS_MAX);
    }
  });
  startJob(deps, id, view, (signal) => drawView(deps, id, view, before, adjustment, decide, signal));
  return { draft: saved };
}

async function drawView(
  deps: AssetBuildDeps,
  id: string,
  view: PresenterView,
  before: ViewStatus,
  adjustment: string | undefined,
  decide: 'auto' | undefined,
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
        if (before === 'approved') {
          // A view that decided itself may still hold the prior it replaced;
          // that one was never chosen over the picture now being replaced.
          if (slot.prior && slot.prior !== slot.hash && !r.sources.includes(slot.prior)) {
            slot.rejected = [...slot.rejected, slot.prior];
          }
          slot.prior = slot.hash;
        } else if (slot.origin === 'generated') slot.rejected = [...slot.rejected, slot.hash];
      }
      slot.status = 'candidate';
      slot.hash = hash;
      slot.origin = 'generated';
      slot.attempts += 1;
      slot.conditionedOn = refs;
      slot.adjustment = adjustment;
      slot.error = undefined;
      r.generations += 1;
      r.results = [
        ...r.results,
        { view, hash, at: new Date().toISOString(), ...(adjustment ? { ask: adjustment } : {}), how: 'drawn' as const },
      ].slice(-RESULTS_MAX);
      if (decide === 'auto') {
        // Straight to approved, exactly as Use would take it, except that the
        // prior stays on the slot so Keep previous is still on offer. What
        // was drawn from the old picture no longer stands, as on Use.
        slot.status = 'approved';
        if (slot.prior) staleDependents(r, view);
      }
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
  // The record's words, with the identity edits accepted in this session
  // after them; with no words yet, the edits still ride so a photo person's
  // later views follow the change rather than the originals.
  const edits = rec.identityEdits ?? [];
  const words = rec.analysis
    ? { ...rec.analysis, identityEdits: edits }
    : edits.length
      ? { promptName: ATTACHED_PERSON, identityEdits: edits }
      : null;
  const who = whoIs(rec.name || 'this person', words);
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
  if (slot.status === 'approved') {
    if (!slot.prior) return rec;
    // A view that decided itself, confirmed: the prior it kept for Keep
    // previous retires. Its dependents were already staled when it landed.
    return mutate(deps.core, id, (r) => {
      const s = r.views[view];
      if (s.prior && !r.sources.includes(s.prior)) s.rejected = [...s.rejected, s.prior];
      s.prior = undefined;
    });
  }
  if (slot.status === 'stale') throw fail(`redo the ${VIEW_LABEL[view]}: it was built on a view you changed`, 400);
  if (slot.status !== 'candidate' || !slot.hash) throw fail(`there is no ${VIEW_LABEL[view]} to approve yet`, 400);
  return mutate(deps.core, id, (r) => {
    const s = r.views[view];
    s.status = 'approved';
    r.decisions = [...r.decisions, { view, what: 'use' as const, at: new Date().toISOString() }].slice(-RESULTS_MAX);
    if (s.prior) {
      // A revision took an approved picture's place: whatever was drawn from
      // the old one no longer stands, and is drawn again from this one.
      if (!r.sources.includes(s.prior)) s.rejected = [...s.rejected, s.prior];
      s.prior = undefined;
      staleDependents(r, view);
      // In an edit session, a face redrawn with an instruction and then used
      // is an identity edit: it rides on every view drawn after it, and on
      // the record. Keep previous never records one.
      if (view === 'portrait' && r.presenterId && s.adjustment) {
        r.identityEdits = mergeIdentityEdits(r.identityEdits, s.adjustment);
      }
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
    r.decisions = [...r.decisions, { view, what: 'keep' as const, at: new Date().toISOString() }].slice(-RESULTS_MAX);
  });
}

/**
 * A picture from before, back on its view: the record's restore point, one
 * to one, nothing drawn. The picture it replaces stays as the prior, so Keep
 * previous still works, and what was drawn from the replaced picture no
 * longer stands. The restored picture leaves the let-go list, so it is kept.
 */
export async function restoreView(
  deps: AssetBuildDeps,
  id: string,
  view: PresenterView,
  hash: string,
): Promise<PresenterDraftRecord> {
  if (!isView(view)) throw fail('no such view', 400);
  if (!HASH.test(String(hash))) throw fail('no such picture', 400);
  if (running.has(id)) throw fail('a view is still being drawn', 409);
  const rec = getPresenterDraft(deps.core, id);
  if (!rec) throw fail('draft not found', 404);
  const slot = rec.views[view];
  const known =
    rec.results.some((r) => r.view === view && r.hash === hash) || slot.prior === hash || slot.rejected.includes(hash);
  if (!known) throw fail(`that was never the ${VIEW_LABEL[view]}`, 400);
  if (!existsSync(deps.core.images.pathFor(hash))) throw fail('that picture is gone', 410);
  if (slot.hash === hash) return rec;
  const from = [...rec.results].reverse().find((r) => r.view === view && r.hash === hash);
  return mutate(deps.core, id, (r) => {
    const s = r.views[view];
    const was = s.hash;
    if (s.status === 'approved' && was) {
      if (s.prior && s.prior !== was && !r.sources.includes(s.prior)) s.rejected = [...s.rejected, s.prior];
      s.prior = was;
    } else if (was && !r.sources.includes(was)) s.rejected = [...s.rejected, was];
    s.rejected = s.rejected.filter((h) => h !== hash);
    s.hash = hash;
    s.origin = r.sources.includes(hash) ? 'photo' : 'generated';
    if (s.status !== 'candidate') s.status = 'approved';
    s.adjustment = from?.ask;
    s.conditionedOn = undefined;
    s.error = undefined;
    if (s.status === 'approved') staleDependents(r, view);
    r.results = [...r.results, { view, hash, at: new Date().toISOString(), how: 'restored' as const }].slice(
      -RESULTS_MAX,
    );
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
    r.decisions = [...r.decisions, { view, what: 'again' as const, at: new Date().toISOString() }].slice(-RESULTS_MAX);
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

/** The words around the person, and the extras switch. None of these touch a view. */
export async function updatePresenterDraft(
  core: Core,
  id: string,
  patch: { name?: unknown; facets?: unknown; direction?: unknown; extras?: unknown },
): Promise<PresenterDraftRecord> {
  return mutate(core, id, (r) => {
    if (patch.extras !== undefined) r.extras = patch.extras === true;
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
 * evidence. The three core views are required; an extra is required only
 * once something was drawn into it, and then it has to be approved like any
 * other. Then the draft goes, and with it every rejected picture nothing
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
  if (rec.presenterId) return saveEdit(deps, rec, hooks);
  if (!rec.name.trim()) throw fail('give them a name', 400);
  // Without an engine the photographs are the presenter: the portrait leads
  // and the rest follow as they are. Fewer views than a drawn set has, but a
  // working person rather than a blocked flow, exactly the old build's
  // fallback.
  const blind = !deps.engine;
  // In save order: the core views, then whichever extras were drawn.
  const required: PresenterView[] = blind
    ? ['portrait']
    : [...CORE_VIEWS, ...EXTRA_VIEWS.filter((v) => rec.views[v].status !== 'empty')];
  for (const v of required) {
    const s = rec.views[v];
    if (s.status === 'stale') throw fail(`redo the ${VIEW_LABEL[v]}: it was built on a view you changed`, 400);
    if (s.status !== 'approved' || !s.hash) throw fail(`approve the ${VIEW_LABEL[v]} first`, 400);
  }
  const approved = required.map((v) => rec.views[v].hash as string);
  const shots = blind ? [...approved, ...rec.sources.filter((h) => !approved.includes(h))] : approved;
  const angles = blind ? ['portrait'] : [...required];
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
  removeUnreferenced(core, letGoOf(rec), hooks);
  return { presenter: built.presenter, brand: core.store.getBrand(rec.brandId) };
}

/**
 * The pictures a session let go of: the rejected ones, and a prior a
 * self-decided view was still carrying, which was never chosen over the
 * picture that replaced it.
 */
function letGoOf(rec: PresenterDraftRecord): string[] {
  return PRESENTER_VIEWS.flatMap((v) => {
    const s = rec.views[v];
    return [...s.rejected, ...(s.prior && s.prior !== s.hash ? [s.prior] : [])];
  });
}

/**
 * Save an edit session. Provenance decides the shape of the write: a saved
 * shot names only the presenter's id, so a change to any picture or to the
 * identity prose is written as a new record with a fresh id, and the old one
 * is kept, marked superseded, still exactly what its own shots refine
 * against. A change to the words around the person (name, categories)
 * patches the record in place. Either way the session's row goes, and with
 * it every rejected picture nothing holds; the superseded record holds its
 * own, so its pictures stay.
 */
async function saveEdit(
  deps: AssetBuildDeps,
  rec: PresenterDraftRecord,
  hooks: CleanupHooks,
): Promise<{ presenter: CustomPresenter; brand: ReturnType<Core['store']['getBrand']> }> {
  const { core } = deps;
  const brand = core.store.getBrand(rec.brandId);
  if (!brand) throw fail('brand not found', 404);
  const base = brandCharacters(brand.json).find((c) => c?.id === rec.presenterId) as CustomPresenter | undefined;
  if (!base) throw fail('this presenter no longer exists', 404);
  const moved = () => fail('this presenter changed elsewhere; reload to continue', 409);
  const baseId = rec.baseId ?? '';
  if (!baseId || headOf(brand.json, baseId) !== baseId) throw moved();
  if (!rec.name.trim()) throw fail('give them a name', 400);
  // Every view the record had and every view the session filled must stand.
  // A record is never asked to grow: a legacy one-shot person saves with the
  // one view it has.
  const seeded = slotsFromRecord(base);
  const required = PRESENTER_VIEWS.filter((v) => rec.views[v].status !== 'empty' || seeded.views[v].status !== 'empty');
  for (const v of required) {
    const s = rec.views[v];
    if (s.status === 'stale') throw fail(`redo the ${VIEW_LABEL[v]}: it was built on a view you changed`, 400);
    if (s.status !== 'approved' || !s.hash) throw fail(`approve the ${VIEW_LABEL[v]} first`, 400);
  }
  const views = required.map((v) => ({ hash: rec.views[v].hash as string, angle: v }));
  const kept = rec.keptShots ?? [];
  const nextFiles = [...views.map((v) => `asset:${v.hash}`), ...kept.map((k) => k.file)];
  const baseFiles = (base.shots ?? []).map((s) => s.file);
  const samePictures = nextFiles.length === baseFiles.length && nextFiles.every((f) => baseFiles.includes(f));
  const sameEdits = JSON.stringify(rec.identityEdits) === JSON.stringify(base.identityEdits ?? []);
  const direction = rec.direction ?? '';
  const sameDirection = direction === seedDirection(base);
  let head: CustomPresenter;
  if (samePictures && sameEdits && sameDirection) {
    const built = presenterRecordFrom({ name: rec.name, suitableCategories: rec.facets }, base);
    if (!built.ok) throw fail(built.error, 400);
    const patched = built.presenter;
    commit(core, rec.brandId, (json) => {
      if (headOf(json, baseId) !== baseId) throw moved();
      json.characters = brandCharacters(json).map((c: any) => (c.id === base.id ? patched : c));
    });
    head = patched;
  } else {
    if (!views.length) throw fail('approve the face first', 400);
    // The crops come off the leading view exactly as a creation derives
    // them, so an unchanged face keeps its avatar hash, content-addressed.
    const first = views[0];
    const mode = presenterCropMode(
      `asset:${first.hash}`,
      rec.sources.map((h) => `asset:${h}`),
      first.angle,
    );
    const { previewHash, avatarHash } = await presenterCrops(core, first.hash, mode);
    const built = mintRevision(base, {
      name: rec.name,
      shotHashes: views.map((v) => v.hash),
      shotAngles: views.map((v) => v.angle),
      ...(rec.sources.length ? { sourceHashes: rec.sources } : {}),
      previewHash,
      avatarHash,
      suitableCategories: rec.facets,
      identityEdits: rec.identityEdits,
      // Recorded, never inferred: a record with no source stays without one.
      ...(base.source ? { source: rec.source } : {}),
      ...(sameDirection ? {} : { identityNotes: direction }),
      // A read taken in this session describes the face as it is now; with
      // none, the record's own words and casting prose carry.
      ...readWords(rec.analysis),
    });
    if (!built.ok) throw fail(built.error, 400);
    const minted = kept.length
      ? { ...built.presenter, shots: [...(built.presenter.shots ?? []), ...kept] }
      : built.presenter;
    commit(core, rec.brandId, (json) => {
      if (headOf(json, baseId) !== baseId) throw moved();
      json.characters = [
        ...brandCharacters(json).map((c: any) => (c.id === base.id ? { ...c, supersededBy: minted.id } : c)),
        minted,
      ];
    });
    head = minted;
  }
  core.store.deletePresenterDraft(rec.id);
  removeUnreferenced(core, letGoOf(rec), hooks);
  return { presenter: head, brand: core.store.getBrand(rec.brandId) };
}

/** What a fresh analyzer read contributes to a revision: only what it actually said. */
function readWords(a: AnalyzerDraft | undefined): Partial<PresenterInput> {
  if (!a) return {};
  const out: Partial<PresenterInput> = {};
  const said = (v: unknown) => v != null && v !== '' && !(Array.isArray(v) && !v.length);
  if (said(a.promptName)) out.promptName = a.promptName;
  if (said(a.presentation)) out.presentation = a.presentation;
  if (said(a.descriptor)) out.descriptor = a.descriptor;
  if (said(a.ageRange)) out.ageRange = a.ageRange;
  if (said(a.hair)) out.hair = a.hair;
  if (said(a.negativeConstraints)) out.negativeConstraints = a.negativeConstraints;
  if (said(a.facial)) out.facial = a.facial;
  if (said(a.skin)) out.skin = a.skin;
  if (said(a.build)) out.build = a.build;
  return out;
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
