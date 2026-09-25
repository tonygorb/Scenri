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
import { basename } from 'node:path';
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
  DEPENDS,
  HAND_APPROVED,
  VIEW_LABEL,
  EXTRA_VIEWS,
  PRESENTER_VIEWS,
  identityOf,
  itemsFor,
  keptAspects,
  type KeepItem,
  keepSentenceOf,
  studioPrompt,
  keepFor,
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
  /**
   * When the step now running began.
   *
   * The clock a person watches has to measure the work, and the row's own
   * updated stamp measures something else entirely: every write touches it,
   * so the analyzer finishing, or a name typed while the picture draws, sent
   * the elapsed time back to 0:00 and read as the whole thing starting over.
   * Written once when the job is admitted, gone when it lands.
   */
  startedAt?: string;
  /**
   * What the slot was when the step now running began. The failure path puts
   * it back from memory; a restart has only the row, and without this it
   * brought a stale picture of the old face back as a candidate to be used.
   * Written with `startedAt`, gone when the step ends.
   */
  was?: ViewStatus;
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
  /**
   * What the person said should stay the same whenever this presenter appears:
   * a tattoo, glasses they always wear, a scar, a prosthetic limb, the long
   * tail nobody can enumerate. Their own words, in one sentence, and the only
   * thing here that is meant to outlive the draft: it rides every view's
   * prompt and becomes the record's identity notes on save.
   */
  keep?: string;
  /**
   * The same, one thing at a time, which is the form that survives.
   *
   * `keep` is the sentence they make and is kept in step with them for
   * anything that reads a draft as words; this is the truth. A sentence has
   * one length and a cap cuts it wherever it lands, so four details joined
   * once reached the store as "in place of their le" with the side gone. Each
   * item is capped on its own, and carries its own pictures, so which detail
   * a picture belongs to survives too.
   */
  keepItems?: KeepItem[];
  /**
   * The conversation's own answers, as the studio holds them. Opaque here.
   *
   * What the server needs is compiled out of these before it arrives, so it
   * has no use for them and never reads them. The page does: without them a
   * draft opened in another tab, or after the browser was closed, came back as
   * one typed sentence with every aside gone, because a compiled direction
   * cannot be un-compiled into the taps that made it.
   */
  setup?: string;
  /**
   * Pictures of the details themselves, by detail: a pair of frames, a
   * tattoo's design. Drawn from with the `detail` role, which takes the thing
   * and nothing of whoever is wearing it in the picture.
   *
   * Derived from `keepItems` whenever those are given, so the two cannot
   * disagree about which picture belongs to which detail.
   */
  detailRefs?: Record<string, string[]>;
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

// Both are the view table's own, re-exported from here because this is where
// the draft machinery and its tests have always reached for them.
export { DEPENDS, VIEW_LABEL } from './presenterPrompts.js';

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
  if (j.keep) rec.keep = String(j.keep);
  if (j.setup) rec.setup = String(j.setup);
  // A draft stored before items existed holds only the sentence; it is read
  // back as items the first time it is asked for, never rewritten in place.
  const keepItems = keepItemsOf(j.keepItems);
  if (keepItems) rec.keepItems = keepItems;
  const detailRefs = detailRefsOf(j.detailRefs);
  if (detailRefs) rec.detailRefs = detailRefs;
  if (j.attestation) rec.attestation = j.attestation;
  if (j.analysis) rec.analysis = j.analysis;
  if (j.readError) rec.readError = String(j.readError);
  if (j.presenterId) rec.presenterId = String(j.presenterId);
  if (j.baseId) rec.baseId = String(j.baseId);
  if (Array.isArray(j.keptShots) && j.keptShots.length) rec.keptShots = j.keptShots.map(shotOf);
  backfillRecord(rec);
  return rec;
}

/**
 * A draft from before the record was kept has pictures on its views and no
 * results or asks to show them by. Read them off the slots once, in view
 * order, dated when the draft last changed: the record then reads as one,
 * and every picture on a view is a restore point.
 */
function backfillRecord(rec: PresenterDraftRecord): void {
  if (rec.results.length) return;
  const at = rec.updatedAt || rec.createdAt;
  for (const v of PRESENTER_VIEWS) {
    const s = rec.views[v];
    if (!s.hash || s.origin !== 'generated') continue;
    if (s.adjustment && !rec.asks.some((a) => a.view === v && a.text === s.adjustment)) {
      rec.asks = [...rec.asks, { view: v, text: s.adjustment, at }];
    }
    rec.results = [
      ...rec.results,
      { view: v, hash: s.hash, at, ...(s.adjustment ? { ask: s.adjustment } : {}), how: 'drawn' },
    ];
  }
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

/**
 * What a card needs to offer an unfinished person back.
 *
 * A row carries its whole conversation: every ask, every result, every
 * decision. A library page drawing ten cards has no use for any of it, and
 * hydrating ten conversations to render ten thumbnails is the kind of thing
 * that makes a page feel slow for no reason anyone can see.
 */
export interface PresenterDraftSummary {
  id: string;
  name: string;
  source: PresenterSource;
  updatedAt: string;
  /** When it was started. The wall is ordered by this, so choosing one never moves it. */
  createdAt: string;
  stage: 'idle' | 'analyzing' | 'drawing';
  /** Set when this is an edit of somebody already saved, which is not unfinished work. */
  presenterId?: string;
  /** The best picture it has: the face if it has one, else a photograph it was given. */
  hash?: string;
  /** Views decided so far, out of the set this draft is building. */
  approved: number;
  of: number;
  drawing: boolean;
  /** Pictures drawn for it, decided or not: what a discard would throw away. */
  drawn: boolean;
}

/** The face first, because that is the person; then anything else drawn; then their own photographs. */
function bestPicture(rec: PresenterDraftRecord): string | undefined {
  const drawn = PRESENTER_VIEWS.map((v) => rec.views[v]).find((s) => s.hash);
  return rec.views.portrait.hash ?? drawn?.hash ?? rec.sources[0];
}

export function summarisePresenterDraft(rec: PresenterDraftRecord): PresenterDraftSummary {
  const wanted = rec.extras ? PRESENTER_VIEWS : CORE_VIEWS;
  const summary: PresenterDraftSummary = {
    id: rec.id,
    name: rec.name,
    source: rec.source,
    updatedAt: rec.updatedAt,
    createdAt: rec.createdAt,
    stage: rec.stage,
    approved: wanted.filter((v) => rec.views[v].status === 'approved').length,
    of: wanted.length,
    drawing: rec.stage !== 'idle' || !!rec.activeView,
    // Drawn work a discard would throw away, decided or not. A photograph is
    // still on disk as itself, so it does not count; a candidate face does,
    // which counting approved views alone would have missed.
    drawn: PRESENTER_VIEWS.some((v) => {
      const s = rec.views[v];
      return !!s.hash && s.origin !== 'photo' && s.status !== 'empty';
    }),
  };
  const hash = bestPicture(rec);
  if (hash) summary.hash = hash;
  if (rec.presenterId) summary.presenterId = rec.presenterId;
  return summary;
}

/** The brand's unfinished people, newest first. */
export function listPresenterDraftSummaries(core: Core, brandId: string): PresenterDraftSummary[] {
  // Oldest first, by when they were started. The rows come back by when they
  // were last touched, which is right for finding the one somebody is working
  // on and wrong for a wall: opening a draft touches it, so the cards
  // rearranged themselves under the finger that had just chosen one.
  return listPresenterDrafts(core, brandId)
    .map(summarisePresenterDraft)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

export function listPresenterDrafts(core: Core, brandId: string): PresenterDraftRecord[] {
  return core.store.listPresenterDrafts(brandId).map(fromRow);
}

/* ------------------------------------------------------------------ jobs */

const running = new Map<string, { view: PresenterView | null; ctrl: AbortController }>();
/** Set while the server is going away: nothing new starts, not even the next view of a set. */
let closing = false;
const restarting = () => fail('Scenri is restarting; try again in a moment', 503);
/**
 * The face whose read failed, by draft. The read only adds words, so a view
 * is drawn without it, and the same face is not read again on every view
 * after it. In memory: a restart is a fair moment to try once more.
 */
const unreadable = new Map<string, string>();

/**
 * One run of a draft's work, as Activity shows it. A set that goes on view
 * after view on its own is one run, from the first of them to the last, so it
 * is one row and, when it ends, one piece of news rather than three.
 */
export interface DraftRun {
  id: string;
  draftId: string;
  brandId: string;
  /** The view being drawn, or last drawn; null for the photo read. */
  view: PresenterView | null;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  error: string | null;
}
/** The latest run per draft. In memory, like the jobs it describes. */
const runs = new Map<string, DraftRun>();
const RUN_KEEP_MS = 24 * 60 * 60 * 1000;

function beginRun(deps: AssetBuildDeps, id: string, view: PresenterView | null, chained: boolean): void {
  const prev = runs.get(id);
  if (chained && prev?.status === 'running') {
    // The set is one run, so a view that failed on the way fails it, whichever
    // view it ends on. Carried here while it runs; shown only once it has ended.
    const failed = prev.view ? getPresenterDraft(deps.core, id)?.views[prev.view].error : undefined;
    runs.set(id, { ...prev, view, error: prev.error ?? (failed && failed !== 'cancelled' ? failed : null) });
    return;
  }
  runs.set(id, {
    id: randomUUID().slice(0, 8),
    draftId: id,
    brandId: getPresenterDraft(deps.core, id)?.brandId ?? '',
    view,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    error: null,
  });
}

function endRun(deps: AssetBuildDeps, id: string, view: PresenterView | null, aborted: boolean): void {
  const run = runs.get(id);
  if (!run || run.status !== 'running') return;
  const rec = getPresenterDraft(deps.core, id);
  const own = view ? rec?.views[view].error : rec?.readError;
  const error = own && own !== 'cancelled' ? own : run.error;
  const failed = !aborted && !!error;
  runs.set(id, {
    ...run,
    view,
    finishedAt: new Date().toISOString(),
    status: aborted ? 'cancelled' : failed ? 'failed' : 'done',
    error: failed ? (error ?? null) : null,
  });
}

/** The runs Activity shows for a brand: what draws now, and what finished in the last day. */
export function presenterDraftRuns(brandId: string, now = Date.now()): DraftRun[] {
  for (const [id, r] of runs) if (r.finishedAt && now - Date.parse(r.finishedAt) > RUN_KEEP_MS) runs.delete(id);
  return [...runs.values()].filter((r) => r.brandId === brandId);
}

/** How many drafts are mid-step: the update path refuses to restart over one. */
export function runningDraftJobCount(): number {
  return running.size;
}

/** Test seam: the module-level registry outlives a test server otherwise. */
export function resetPresenterDrafts(): void {
  for (const job of running.values()) job.ctrl.abort();
  running.clear();
  runs.clear();
  unreadable.clear();
  closing = false;
}

/**
 * Stop every draft's work and wait for it to write its outcome: a server going
 * away. A draw that lands into a home being torn down writes an image nobody
 * will read, and a Codex child left drawing keeps spending after the studio is
 * gone. Bounded, like the node drain.
 */
export async function settlePresenterDrafts(): Promise<void> {
  closing = true;
  for (const job of running.values()) job.ctrl.abort();
  const deadline = Date.now() + 5000;
  while (running.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
}

/**
 * After a restart, a slot the row says is generating has nothing behind it:
 * the process that was drawing it is gone. Put it back to what it was, with
 * the reason on it, the way the nodes table sweeps its running rows.
 */
export function sweepPresenterDrafts(core: Core): number {
  // A server starting is not one going away. Only a test runs a second one in
  // the same process, and it must not inherit the first one's drain.
  closing = false;
  let swept = 0;
  for (const brand of core.store.listBrands()) {
    for (const rec of listPresenterDrafts(core, brand.id)) {
      const stuck = PRESENTER_VIEWS.filter((v) => rec.views[v].status === 'generating');
      if (!stuck.length && !rec.activeView && rec.stage === 'idle') continue;
      for (const v of stuck) {
        const slot = rec.views[v];
        // The same outcome the failure path gives a step that did not land.
        if (!slot.hash && slot.prior) {
          slot.hash = slot.prior;
          slot.prior = undefined;
          slot.origin = 'generated';
          slot.status = dependents(v).some((d) => rec.views[d].hash) ? 'approved' : 'candidate';
        } else if (slot.was && slot.was !== 'generating') slot.status = slot.was;
        // A row from before `was` was kept: what it was drawn from, and what
        // was drawn from it, are what is left to say what it was.
        else if (!slot.hash) slot.status = 'empty';
        else if (slot.conditionedOn?.length && !stillStands(rec, v)) slot.status = 'stale';
        else slot.status = dependents(v).some((d) => rec.views[d].hash) ? 'approved' : 'candidate';
        slot.error = 'interrupted: server restarted mid-generation';
        slot.startedAt = undefined;
        slot.was = undefined;
      }
      // The photo read (the one step with no view) said nothing, and nothing reads them again.
      if (rec.stage === 'analyzing' && !rec.activeView && !rec.analysis && !rec.readError) {
        rec.readError = 'Scenri restarted before the read finished';
      }
      rec.activeView = null;
      rec.stage = 'idle';
      put(core, rec);
      swept += 1;
    }
  }
  return swept;
}

/** How much of one kept thing is stored, and how many of them. */
const KEEP_ITEM_CHARS = 200;
/** Room for the answers and the forty asides the studio keeps, and no more. */
const SETUP_CHARS = 40_000;
const KEEP_ITEMS_MAX = 12;
/** Photographs a draft keeps: what a saved presenter holds (presenterRecordFrom). The studio offers four. */
const SOURCES_MAX = 8;

/**
 * The kept things, each carried whole.
 *
 * The cap is per item, which is the whole point of the shape: the sentence
 * they used to arrive as was capped at 240 and the cut landed mid-clause, so
 * the last detail chosen was the first one lost and "in place of their left
 * arm" became "in place of their le". Two hundred characters is more than
 * twice the longest thing the rows can produce, and an item longer than that
 * loses its own tail rather than somebody else's.
 */
function keepItemsOf(raw: unknown, has?: (h: string) => boolean): KeepItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: KeepItem[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, KEEP_ITEMS_MAX)) {
    if (!r || typeof r !== 'object') continue;
    const words = str((r as { words?: unknown }).words, KEEP_ITEM_CHARS);
    if (!words) continue;
    let id = str((r as { id?: unknown }).id, 40) || 'said';
    while (seen.has(id)) id = `${id}+`;
    seen.add(id);
    const refs = (Array.isArray((r as { refs?: unknown }).refs) ? ((r as { refs: unknown[] }).refs as unknown[]) : [])
      .map(String)
      .filter((h) => HASH.test(h) && (!has || has(h)))
      .slice(0, 4);
    out.push(refs.length ? { id, words, refs } : { id, words });
  }
  return out;
}

/**
 * The sentence and the picture map the items make.
 *
 * Written beside the items rather than derived at every read, so anything
 * that still reads a draft as words (the save, a client, a test) sees the
 * same thing the prompts do, and the two cannot drift apart.
 */
function writeItems(r: PresenterDraftRecord, items: KeepItem[]): void {
  r.keepItems = items.length ? items : undefined;
  r.keep = keepSentenceOf(items) || undefined;
  const refs: Record<string, string[]> = {};
  for (const i of items) if (i.refs?.length) refs[i.id] = i.refs;
  r.detailRefs = Object.keys(refs).length ? refs : undefined;
}

/** Pictures of the details, by detail: a few hashes each, and only ones that are here. */
function detailRefsOf(raw: unknown, has?: (h: string) => boolean): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 8)) {
    const key = str(k, 40);
    if (!key || !Array.isArray(v)) continue;
    const hashes = v
      .map(String)
      .filter((h) => HASH.test(h) && (!has || has(h)))
      .slice(0, 4);
    if (hashes.length) out[key] = hashes;
  }
  return Object.keys(out).length ? out : undefined;
}

type RefRole = 'character' | 'detail';

/* ---------------------------------------------------------------- create */

export interface CreateDraftInput {
  brandId: string;
  source: PresenterSource;
  direction?: string;
  /** What should stay the same about them, in their own words. */
  keep?: string;
  /** The same, one thing at a time. Given, these win: see writeItems. */
  keepItems?: KeepItem[];
  /** Pictures of the details themselves, by detail. */
  detailRefs?: Record<string, string[]>;
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
  const keep = str(input.keep, 240);
  const keepItems = keepItemsOf(input.keepItems, (h) => core.images.has(h));
  // Capped here, not at save: every one of them is sent to the read, and one
  // past the record's cap was dropped at save with its file left behind.
  const sources = [
    ...new Set((input.imageHashes ?? []).map(String).filter((h) => HASH.test(h) && core.images.has(h))),
  ].slice(0, SOURCES_MAX);
  if (source === 'synthetic' && !direction) throw fail('describe who they are in a sentence', 400);
  // A person from a description is nothing but what an engine draws.
  if (source === 'synthetic' && !deps.engine) throw fail('no engine here can draw a person', 400);
  if (source === 'photos' && !sources.length) throw fail('add at least one photo of this person', 400);
  if (source === 'photos' && !input.attestation) {
    throw fail("confirm you have permission to use this person's likeness", 400);
  }
  // Photographs start a read, and a read started now is past the drain's abort.
  if (source === 'photos' && closing) throw restarting();
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
  if (keepItems) writeItems(rec, keepItems);
  else {
    if (keep) rec.keep = keep;
    const detailRefs = detailRefsOf(input.detailRefs, (h) => core.images.has(h));
    if (detailRefs) rec.detailRefs = detailRefs;
  }
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

/**
 * The record's own words, cut the way the session's direction is seeded from
 * them, so an unchanged direction compares equal.
 *
 * `promptName` is last and it is the one that matters for a person who was
 * described rather than photographed: the save writes their direction there
 * (`promptName: a?.promptName ?? rec.direction`), and neither of the other two
 * is written at all unless an analyzer filled them. So an edit session opened
 * on a described presenter came back with no direction, and the guard that
 * refuses to draw a synthetic draft without one turned every redraw in that
 * session into "describe who they are in a sentence". Five browser tests
 * failed on it and the whole edit flow was unusable for anybody who typed a
 * person instead of uploading one.
 */
const seedDirection = (p: CustomPresenter) => {
  const said = str(p.identityNotes ?? p.descriptor ?? p.promptName, 400);
  if (said) return said;
  // A record written before any prose was kept still says things about them.
  // With none of the three above, the session opened with no direction and
  // every draw was refused with "describe who they are in a sentence", from
  // Build them to a retry to an identity edit, with nothing on the page that
  // could supply one: a dead end on the oldest presenters in a library. Their
  // own fields are the sentence.
  return str([p.presentation, p.ageRange, p.hair && `${p.hair} hair`].filter(Boolean).join(', '), 400);
};

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
    // Every one of them, not any: a record carrying a single supplementary
    // view was never a record whose owner asked for the whole set, and
    // reading it that way made the save demand two more nobody wanted.
    extras: EXTRA_VIEWS.every((v) => views[v].status !== 'empty'),
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
 * view say so on the record, and ride as references when a view is drawn.
 * None of them becomes a view: what a photograph shows is evidence of the
 * person, not a frame of the set. A read that fails (the engine's limit, a
 * dropped connection) lands the same way, with the reason on the row, so the
 * draft never sits empty and silent, and the face is still drawn from the
 * pictures that were given.
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
      // A read cut short by Stop says so like a failed one: nothing reads them again.
      readError = signal.aborted ? 'the read was stopped' : String(err?.message ?? 'the photos could not be read');
    }
  }
  mutate(core, id, (r) => {
    if (analysis) r.analysis = analysis;
    r.readError = readError;
    // The photographs are evidence, never a canonical view.
    //
    // They used to be adopted straight into whatever slot the read filed them
    // under, and the face on top of that, so a presenter built from three
    // pictures kept two raw uploads and one drawn frame as its reference set.
    // Every shot of that person was then conditioned on a mix of studio frames
    // and a phone photograph in whatever clothes and light it was taken in,
    // which is the one thing the capture uniform exists to prevent, and the
    // face Scenri leads with was not a face Scenri had ever drawn.
    //
    // So nothing is adopted. The face is drawn from the photographs first and
    // decided like any other, the views built on the face follow it, and the
    // originals stay where they belong: on the record as the photographs that
    // were given, and in the references that ride with every draw.
  });
}

function startJob(
  deps: AssetBuildDeps,
  id: string,
  view: PresenterView | null,
  work: (signal: AbortSignal) => Promise<void>,
  after?: () => void,
  chained = false,
): void {
  const ctrl = new AbortController();
  running.set(id, { view, ctrl });
  beginRun(deps, id, view, chained);
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
        runs.delete(id);
        return;
      }
      // In the same run as the idle write above, so no poll ever sees the set
      // standing still between one view and the next.
      if (!ctrl.signal.aborted && !closing) after?.();
      // the run is over unless the set just went on to its next view
      if (!running.has(id)) endRun(deps, id, view, ctrl.signal.aborted);
    });
}

/**
 * The set goes on without the page. Once a view has decided itself, the next
 * view it unlocks is drawn the same way, here on the server, so a person who
 * leaves after Use this person comes back to the whole set rather than to a
 * set that waited for them. The studio's own step effect still asks for the
 * same draw when it is open; the one-job-per-draft guard answers it with 409,
 * which it reads as "already happening".
 *
 * Only views that decide themselves, only in the order their dependencies
 * allow, and never a view that carries an error: a stopped or failed view
 * stops the chain until someone asks for it again.
 */
function continueSet(deps: AssetBuildDeps, id: string): void {
  const rec = getPresenterDraft(deps.core, id);
  if (!rec || running.has(id) || !deps.engine) return;
  const wanted = rec.extras ? PRESENTER_VIEWS : CORE_VIEWS;
  const next = wanted.find((v) => {
    const slot = rec.views[v];
    if (HAND_APPROVED.has(v) || slot.error) return false;
    if (slot.status !== 'empty' && slot.status !== 'stale') return false;
    return DEPENDS[v].every((dep) => rec.views[dep].status === 'approved');
  });
  if (!next) return;
  // Caught on the promise: a refusal thrown into nothing is an unhandled
  // rejection, and that ends the whole process with every job in it.
  void generateView(deps, id, next, { decide: 'auto', chained: true }).catch(() => {
    // refused (nothing to draw from, the draft changed): the studio says why when it is next opened
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
  /** `chained`: the set going on by itself, part of the run already under way. Never from a route. */
  opts: { adjustment?: string; decide?: 'auto'; chained?: boolean } = {},
): Promise<{ draft: PresenterDraftRecord }> {
  const { core, engine } = deps;
  if (!isView(view)) throw fail('no such view', 400);
  let rec = getPresenterDraft(core, id);
  if (!rec) throw fail('draft not found', 404);
  if (running.has(id)) throw fail('a view is still being drawn', 409);
  if (closing) throw restarting();
  if (isExtra(view) && !rec.extras) throw fail('extra views are built on request', 400);
  // A described person is drawn from that description, and a draft can lose
  // it: the patch route takes a cleared direction (`updatePresenterDraft`) and
  // nothing revalidated it, so the roll went out as "an adult, : an original
  // person who does not resemble any real, famous or public figure". These are
  // the words the draft would have been refused with at creation.
  if (rec.source === 'synthetic' && !rec.direction?.trim()) {
    /**
     * A record that says nothing about them at all.
     *
     * Editing one of these refused every draw with this message and offered
     * nothing anywhere that could answer it: Build them, a retry and an
     * identity edit all 400, and the only way out was to leave. A sentence
     * typed at a person who has no description is that description, not an
     * adjustment to one that does not exist.
     */
    const said = str(opts.adjustment, 400);
    if (!said) throw fail('describe who they are in a sentence', 400);
    rec = mutate(core, id, (r) => {
      r.direction = said;
    });
  }
  if (opts.decide === 'auto' && HAND_APPROVED.has(view))
    throw fail(`the ${VIEW_LABEL[view]} is always decided by hand`, 400);
  for (const dep of DEPENDS[view]) {
    if (rec.views[dep].status !== 'approved') throw fail(`approve the ${VIEW_LABEL[dep]} first`, 400);
  }
  if (!engine || !engine.capabilities().maxReferenceImages) throw fail('no engine here can draw a person', 400);
  const adjustment = str(opts.adjustment, 240) || undefined;
  const decide = opts.decide === 'auto' ? 'auto' : undefined;
  const before = rec.views[view].status;
  const saved = mutate(core, id, (r) => {
    r.views[view].was = r.views[view].status;
    r.views[view].status = 'generating';
    r.views[view].error = undefined;
    // The one stamp the clock measures: this step, from here.
    r.views[view].startedAt = new Date().toISOString();
    r.activeView = view;
    r.stage = 'drawing';
    // Asked for by a person, the set goes on from here: the views that failed
    // beside this one are drawn after it rather than each waiting for its own
    // Retry. Never by the set itself, which would go round a failure that repeats.
    if (decide === 'auto' && !opts.chained) {
      for (const v of r.extras ? PRESENTER_VIEWS : CORE_VIEWS) {
        const s = r.views[v];
        if (v === view || !s.error || s.error === 'cancelled') continue;
        if (s.status === 'empty' || s.status === 'stale') s.error = undefined;
      }
    }
    // The sentence joins the record once: the same one sent to the same view
    // again is Try again, not a second ask.
    const last = r.asks[r.asks.length - 1];
    if (adjustment && !(last && last.view === view && last.text === adjustment)) {
      r.asks = [...r.asks, { view, text: adjustment, at: new Date().toISOString() }].slice(-ASKS_MAX);
    }
  });
  startJob(
    deps,
    id,
    view,
    (signal) => drawView(deps, id, view, before, adjustment, decide, signal),
    decide === 'auto' ? () => continueSet(deps, id) : undefined,
    opts.chained === true,
  );
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
    const face = rec.views.portrait.hash;
    if (!rec.analysis && analyzer && view !== 'portrait' && face && unreadable.get(id) !== face) {
      mutate(core, id, (r) => {
        r.stage = 'analyzing';
      });
      try {
        const analysis = (await analyzer.analyze(
          {
            kind: 'presenter',
            imagePaths: [core.images.pathFor(face)],
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
      } catch (err) {
        if (signal.aborted) throw err;
        // The read only adds words to a face that rides as a reference anyway.
        // Failing the view on it left the full body behind a Retry that spent
        // another read and failed the same way, every time.
        unreadable.set(id, face);
        rec = mutate(core, id, (r) => {
          r.stage = 'drawing';
        });
      }
    }
    if (signal.aborted) throw new Error('cancelled');

    const { prompt, refs, roles } = planStep(rec, view, adjustment, caps.maxReferenceImages);
    // What they said should stay, as this view carries it. The words can
    // change while it draws (the patch route takes them at any time), and a
    // picture drawn without the glasses they just added is not a current one.
    const kept = keepFor(view, identityOf(rec).items);
    /**
     * The pictures this draw is conditioned on, as they stand right now.
     *
     * A draw takes tens of seconds, and what it is built on can move while it
     * runs: the face it is reading from is approved, redrawn, put back or
     * restored. `staleDependents` cannot help, because it only moves views
     * that are approved or candidate and this one is `generating`. So the
     * result landed as a current picture of the previous person: the new face
     * in the portrait, the old one in the full body, which is the incoherent
     * set nobody could explain.
     */
    const builtOn = new Map(refDeps(rec, view).map((v) => [v, rec.views[v].hash]));
    const paths: string[] = [];
    for (const h of refs) {
      const p = core.images.pathFor(h);
      paths.push(caps.maxReferenceEdge ? await capReferenceEdge(core, p, caps.maxReferenceEdge) : p);
    }
    let drawn: string;
    try {
      drawn = await draw(deps, {
        prompt,
        brandId: rec.brandId,
        ...(paths.length ? { referenceImages: paths, referenceRoles: roles } : {}),
        signal,
      });
    } finally {
      // A reference cut down for the engine is a copy of somebody's photograph
      // that no record names, so it goes once the engine is done with it.
      const cut = paths.filter((p, i) => p !== core.images.pathFor(refs[i])).map((p) => basename(p).split('.')[0]);
      removeUnreferenced(core, cut, {});
    }
    // Before anything chains off it: a bar left on the anchor is a bar the
    // next view is conditioned on and faithfully reproduces.
    const hash = await trimEdgeBars(core, drawn);
    // The frame as it arrived is nobody's picture once the trimmed one is kept.
    if (hash !== drawn) removeUnreferenced(core, [drawn], {});
    // The last moment a Stop can arrive before the slot is written; from here
    // the landing is one synchronous write, so a picture that came back after
    // Stop never lands over the stopped slot, and nothing will ever point at it.
    if (signal.aborted) {
      removeUnreferenced(core, [hash], {});
      throw new Error('cancelled');
    }
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
      slot.startedAt = undefined;
      slot.was = undefined;
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
      // What it was drawn from moved while it drew, so this is a picture of
      // the person as they were. It is kept, because it cost a generation and
      // the log can offer it back, but it stands as stale: the set says it has
      // to be drawn again, and `nextToDraw` draws it from the face that now
      // stands. See `builtOn`.
      for (const [v, was] of builtOn) {
        if (r.views[v].hash !== was) {
          slot.status = 'stale';
          break;
        }
      }
      // The same for the words: drawn from what they no longer say.
      if (keepFor(view, identityOf(r).items) !== kept) slot.status = 'stale';
    });
  } catch (err: any) {
    mutate(core, id, (r) => {
      const slot = r.views[view];
      if (!slot.hash && slot.prior) {
        // It was asked for another picture and did not get one, so it wears
        // what it wore. Approved is the honest status when something was drawn
        // from it: a view can only be drawn from an approved one.
        slot.hash = slot.prior;
        slot.prior = undefined;
        slot.origin = 'generated';
        slot.status = dependents(view).some((v) => r.views[v].hash) ? 'approved' : 'candidate';
      } else slot.status = before === 'generating' ? (slot.hash ? 'candidate' : 'empty') : before;
      slot.attempts += 1;
      // the ask it was for stays on the slot, so drawing it again is drawing it again with the ask
      if (adjustment) slot.adjustment = adjustment;
      slot.error = signal.aborted ? 'cancelled' : String(err?.message ?? 'the view could not be drawn');
      slot.startedAt = undefined;
      slot.was = undefined;
      r.generations += 1;
    });
  }
}

/**
 * The sentence a face is rolled from: who they are, and then what should stay
 * the same about them. The second half is the person's own words, so a scar or
 * a pair of glasses is drawn into the face rather than described beside it.
 */
export function rolledFrom(rec: Pick<PresenterDraftRecord, 'direction' | 'keep' | 'keepItems'>): string {
  const id = identityOf(rec);
  const said = id.said.replace(/[.\s]+$/, '');
  const keep = keepFor('portrait', id.items);
  if (!keep) return said;
  return said ? `${said}, ${keep}` : keep;
}

/** A sentence that names a side: a trait on the left is not the same trait on the right. */
export const namesASide = (text: string | undefined): boolean => /\b(left|right)\b/i.test(text ?? '');

/**
 * Which approved views a view is actually drawn from.
 *
 * Right is never drawn from left. The table already says so; this used to
 * drop left only when keep named a side, which left every other right draw
 * reading the left profile and copying a near-side trait across the face.
 */
export function refDeps(_rec: PresenterDraftRecord, view: PresenterView): PresenterView[] {
  return DEPENDS[view];
}

/** What a step is drawn from and asked for. Pure, so the choice is testable and the manifest honest. */
/**
 * Did the read stand behind this photograph?
 *
 * A photograph it never filed is fine: the filing is by framing, and most
 * photographs fit no named view. One it filed and marked unusable is not.
 */
function usableSource(rec: PresenterDraftRecord, hash: string): boolean {
  const filings = rec.analysis?.photos;
  if (!filings?.length) return true;
  const i = rec.sources.indexOf(hash);
  const said = filings.find((p) => p.index === i);
  return said ? said.usable !== false : true;
}

export function planStep(
  rec: PresenterDraftRecord,
  view: PresenterView,
  adjustment: string | undefined,
  cap: number,
): { prompt: string; refs: string[]; roles: RefRole[]; dropped: string[] } {
  const slot = rec.views[view];
  const id = identityOf(rec);
  const room = Math.max(1, cap);
  // Only the details this view could show: a picture of a pair of frames is
  // worth nothing to a back view, and a face crop cannot use one of a
  // forearm tattoo.
  const shown = itemsFor(view, id.items);
  // A draft written before items carries its pictures in a flat map with
  // nothing saying which detail each one is of. They still ride, on every
  // view: the association is not recoverable from it, and losing the picture
  // is worse than not being able to name it.
  const wanted = rec.keepItems
    ? [...new Set(shown.flatMap((i) => i.refs ?? []))]
    : [...new Set(Object.values(rec.detailRefs ?? {}).flat())];

  // The identity roll conditions on nothing but the sentence, unless the
  // person is being nudged, in which case the candidate rides so a nudge
  // keeps the person and a new roll does not. Every other view rides the
  // approved views in dependency order, then the photographs.
  const roll = rec.source === 'synthetic' && view === 'portrait';
  const identity: string[] = [];
  if (roll) {
    if (adjustment && slot.hash) identity.push(slot.hash);
  } else {
    for (const dep of refDeps(rec, view)) {
      const h = rec.views[dep].hash;
      if (h && rec.views[dep].status === 'approved' && !identity.includes(h)) identity.push(h);
    }
    // Only the photographs the read stood behind. Every reference here is
    // handed to the engine as `character`, which says "the exact person, match
    // their face exactly", so a photograph the read called a different person
    // was being presented as the same person: measured on two uploads of two
    // people, where the second came back `usable: false, apparent person
    // mismatch` and rode anyway. A badly blurred or underexposed one is the
    // same argument more quietly. If the read liked none of them they all
    // ride, because something of the person is better than nothing.
    const stood = rec.sources.filter((h) => usableSource(rec, h));
    for (const h of stood.length ? stood : rec.sources) if (!identity.includes(h)) identity.push(h);
  }

  // One seat is held for a detail when the budget is already full. Without
  // it a person built from four photographs spent the whole budget on
  // identity and the picture of their prosthetic reached no view at all,
  // which is the one thing it was attached for. The seat comes off the end
  // of the list, which is the last photograph, never an approved view: those
  // are what the person is.
  const hold = wanted.length && identity.length >= room ? 1 : 0;
  const kept = identity.slice(0, Math.max(1, room - hold));
  const extra = wanted.filter((h) => !kept.includes(h)).slice(0, Math.max(0, room - kept.length));
  // What could not ride, and why. Nobody is shown this; it exists so that
  // "the reference was sent" is something that can be checked rather than
  // assumed.
  const dropped = [
    ...identity.slice(kept.length).map((h) => `identity ${h}: no room`),
    ...wanted.filter((h) => !kept.includes(h) && !extra.includes(h)).map((h) => `detail ${h}: no room`),
    ...id.items
      .filter((i) => i.refs?.length && !shown.includes(i))
      .map((i) => `detail ${i.id}: not shown in this view`),
  ];
  const refs = [...kept, ...extra];
  const roles: RefRole[] = [...kept.map((): RefRole => 'character'), ...extra.map((): RefRole => 'detail')];
  // Which detail picture is which. Flattened into one anonymous list they
  // arrived as several pictures with nothing saying what any of them was of.
  const named = shown.filter((i) => (i.refs ?? []).some((h) => extra.includes(h)));
  const legend = named.length
    ? ` The attached detail pictures show, in this order: ${named.map((i) => i.words).join('; ')}.`
    : '';
  const who = whoIs(id, view);
  const subject = roll
    ? syntheticIdentitySubject(rolledFrom(rec), { adjustment: kept.length ? adjustment : undefined })
    : adjustment
      ? // The ask is scoped to this view and has to win where it meets the
        // view's own fixed clauses, which is why the override sentence rides
        // with it: every non-face subject already pins "the same person as the
        // attached images" and "their own hair exactly as the attached images
        // show it", so a repair that names hair or a feature was asking for one
        // thing and being told the opposite in the same breath. A second
        // "otherwise identical" would not have settled that; saying which one
        // wins does. What the ask does not name is then held still, the same
        // way it is on a described person's face.
        `${viewSubject(view, who)}. For this view only: ${adjustment}. That change is the point of this picture and overrides anything above that describes it otherwise. ${keptAspects(adjustment)}`
      : viewSubject(view, who);
  return { prompt: studioPrompt(subject) + legend, refs, roles, dropped };
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
      // A revision took an approved picture's place, and the picture it
      // replaced is let go of.
      if (!r.sources.includes(s.prior)) s.rejected = [...s.rejected, s.prior];
      s.prior = undefined;
      // A new face for a person rolled from a sentence is read afresh, as a
      // redo reads it: the words read off the old one led every view drawn
      // after it, and the record, with hair the face no longer has.
      if (view === 'portrait' && r.source === 'synthetic') r.analysis = undefined;
    }
    /**
     * Whatever was drawn from this view is asked whether it still stands.
     *
     * Not conditional on `prior`, and not `staleDependents`. `prior` is only
     * written when the slot was already approved before the redraw, so a face
     * changed while it was still a candidate was approved with nothing staled
     * and nothing recorded: the other views kept the old face and were marked
     * current, silently.
     *
     * `reconcileDependents` asks each one whether the pictures it was actually
     * drawn from are still worn, which is the honest question in every case at
     * once: a changed face stales them, a face put back to the one they were
     * drawn from leaves them alone, and on a first approval there is nothing
     * drawn from it to ask about.
     */
    reconcileDependents(r, view);
    // In an edit session, a face redrawn with an instruction and then used is
    // an identity edit: it rides on every view drawn after it, and on the
    // record. Keep previous never records one, because it never reaches here.
    if (view === 'portrait' && r.presenterId && s.adjustment) {
      r.identityEdits = mergeIdentityEdits(r.identityEdits, s.adjustment);
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
    /**
     * The picture being taken off becomes the other side of the decision.
     *
     * Putting one back is a swap, never a verdict: the view wears the other
     * picture and both are still one press from being worn again. So the slot
     * keeps the status it had. A candidate stays a candidate, and the question
     * already standing over it ("Use it, or keep the previous one") is what
     * says go on; an approved view stays approved, because nothing was waiting
     * to be decided on it.
     *
     * Two bugs have come out of this one line, in opposite directions:
     *
     * - It used to leave `prior` alone, so putting back the picture that WAS
     *   the prior left a candidate whose hash and prior were the same picture:
     *   "Use this" and "Keep previous" offered the same face, and the two that
     *   were really drawn were reachable only from the log.
     * - Fixing that by settling the slot `approved` instead made Put back mean
     *   both "wear this one" and "I have decided, build the next one": the next
     *   generation started before the person could step between the pictures
     *   they were choosing between. Reported 2026-09-16.
     *
     * Writing `prior` is what both of them needed. It cannot equal `hash`,
     * because a restore onto the picture already worn returns above.
     */
    if (s.prior && s.prior !== was && s.prior !== hash && !r.sources.includes(s.prior)) {
      s.rejected = [...s.rejected, s.prior];
    }
    if (was) s.prior = was;
    s.rejected = s.rejected.filter((h) => h !== hash);
    s.hash = hash;
    s.origin = r.sources.includes(hash) ? 'photo' : 'generated';
    s.adjustment = from?.ask;
    s.conditionedOn = undefined;
    s.error = undefined;
    reconcileDependents(r, view);
    // Putting a picture back writes no history: the record is the pictures that
    // were drawn, and which one a view wears is the view's own business. It
    // used to append a row, so going back and forth a few times pushed the
    // early draws out of the capped list and renumbered what was left.
  });
}

/** Every view drawn from this one, transitively. */
function dependents(view: PresenterView): PresenterView[] {
  return PRESENTER_VIEWS.filter((v) => v !== view && reaches(v, view));
}
function reaches(from: PresenterView, to: PresenterView): boolean {
  return DEPENDS[from].some((d) => d === to || reaches(d, to));
}

/**
 * Whether a view still stands on what it was actually drawn from.
 *
 * Every slot records the pictures its own was made from, so this is a question
 * with an answer rather than a guess: if each of its dependencies still wears
 * a picture that is in that list, nothing under it has moved.
 */
function stillStands(r: PresenterDraftRecord, view: PresenterView): boolean {
  const on = r.views[view].conditionedOn;
  if (!on?.length) return false;
  // Asked as "has anything it was drawn from been replaced", never as "does it
  // reference each of its dependencies". Which dependencies a view is drawn
  // from is itself a decision that can change under it - the right profile
  // skips the left one when their own words name a side - and a view drawn
  // under one rule must not read as out of date under another.
  for (const h of on) {
    // The log is capped; the slots are not, and every picture a view let go
    // of stays on it, so a face that rolled out of the log is still found.
    const owner =
      r.results.find((x) => x.hash === h)?.view ??
      PRESENTER_VIEWS.find((v) => v !== view && (r.views[v].prior === h || r.views[v].rejected.includes(h)));
    if (!owner || owner === view) continue;
    if (r.views[owner].hash !== h) return false;
  }
  return true;
}

/**
 * Out of date, or back in date.
 *
 * Staling one way only meant a picture put back exactly as it was left
 * everything under it marked out of date against the very picture it was drawn
 * from, and the only way out was to draw them all again. What a view was made
 * from is recorded, so the question can be asked properly in both directions.
 */
function reconcileDependents(r: PresenterDraftRecord, view: PresenterView): void {
  for (const d of dependents(view)) {
    const s = r.views[d];
    if (!s.hash) continue;
    if (stillStands(r, d)) {
      if (s.status === 'stale') s.status = 'approved';
    } else if (s.status === 'approved' || s.status === 'candidate') staleOut(s);
  }
}

function staleDependents(r: PresenterDraftRecord, view: PresenterView): void {
  for (const d of dependents(view)) {
    const s = r.views[d];
    // A photograph is the truth whatever was drawn upstream of it.
    if (s.origin === 'photo') continue;
    if (s.status === 'approved' || s.status === 'candidate') staleOut(s);
  }
}

/**
 * Out of date, and nothing else. An error on the slot was a redraw of a
 * picture that no longer stands; kept, it held the view out of the set that
 * redraws stale views and replayed an old failure as a new one.
 */
function staleOut(s: ViewSlot): void {
  s.status = 'stale';
  s.error = undefined;
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
    // The picture it wears is kept until another one lands, the way a revision
    // keeps the approved one. Thrown away up front, a draw that then failed
    // for any reason at all left the view with nothing, its dependents staled
    // for a redraw that never happened, and the person told that nothing
    // finished had been touched. A quota running out is enough to do it.
    const gone = [slot.prior].filter((h): h is string => !!h && h !== slot.hash && !r.sources.includes(h));
    r.views[view] = {
      ...emptySlot(),
      attempts: slot.attempts,
      rejected: [...slot.rejected, ...gone],
      ...(slot.hash && !r.sources.includes(slot.hash) ? { prior: slot.hash } : {}),
    };
    // Nothing downstream has moved yet either: what those views were drawn
    // from is still the picture standing here. They stale when the new one is
    // used, which approveView and the auto-decide path already do.
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
  patch: {
    name?: unknown;
    facets?: unknown;
    direction?: unknown;
    keep?: unknown;
    keepItems?: unknown;
    setup?: unknown;
    detailRefs?: unknown;
    extras?: unknown;
  },
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
    if (patch.setup !== undefined) r.setup = str(patch.setup, SETUP_CHARS) || undefined;
    // Items are the truth and bring the sentence and the picture map with
    // them; the two older fields are still taken on their own so a client
    // that has not moved yet keeps working.
    const items = keepItemsOf(patch.keepItems, (h) => core.images.has(h));
    if (items) writeItems(r, items);
    else {
      if (patch.keep !== undefined) r.keep = str(patch.keep, 240) || undefined;
      if (patch.detailRefs !== undefined) r.detailRefs = detailRefsOf(patch.detailRefs, (h) => core.images.has(h));
    }
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
  const rec = getPresenterDraft(deps.core, id);
  if (!rec) throw fail('draft not found', 404);
  if (running.has(id)) throw fail('a view is still being drawn', 409);
  // The draft is busy while it is written: a second Save, or a draw into a
  // draft about to go, is refused rather than started under it.
  running.set(id, { view: null, ctrl: new AbortController() });
  try {
    return rec.presenterId ? await saveEdit(deps, rec, hooks) : await saveNew(deps, rec, hooks);
  } finally {
    running.delete(id);
  }
}

/**
 * The draft as it stands after the crops were cut. Discard does not wait for
 * a save, and it removes every picture the draft alone held, so a save that
 * went on from what it read before would commit a person with no pictures.
 */
function stillThere(core: Core, id: string, crops: (string | undefined)[], hooks: CleanupHooks): void {
  if (getPresenterDraft(core, id)) return;
  removeUnreferenced(
    core,
    crops.filter((h): h is string => !!h),
    hooks,
  );
  throw fail('draft not found', 404);
}

async function saveNew(
  deps: AssetBuildDeps,
  rec: PresenterDraftRecord,
  hooks: CleanupHooks,
): Promise<{ presenter: CustomPresenter; brand: ReturnType<Core['store']['getBrand']> }> {
  const { core } = deps;
  const id = rec.id;
  if (!rec.name.trim()) throw fail('give them a name', 400);
  // Without an engine the photographs are the presenter: the portrait leads
  // and the rest follow as they are. Fewer views than a drawn set has, but a
  // working person rather than a blocked flow, exactly the old build's
  // fallback. Read off the draft, never the probe alone: a probe that times
  // out at save time saved a drawn set as its face and dropped the rest.
  const drawnSet = CORE_VIEWS.some(
    (v) => v !== 'portrait' && rec.views[v].origin === 'generated' && !!rec.views[v].hash,
  );
  const blind = !deps.engine && !drawnSet;
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
  stillThere(core, id, [previewHash, avatarHash], hooks);
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
    identityNotes: keptNotes(rec, a),
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
  commit(
    core,
    rec.brandId,
    (json) => {
      json.characters = [...brandCharacters(json), built.presenter];
    },
    // the row goes with the append, in one transaction: see `commit`
    id,
  );
  removeUnreferenced(core, [...letGoOf(rec), ...detailsOf(rec)], hooks);
  return { presenter: built.presenter, brand: core.store.getBrand(rec.brandId) };
}

/**
 * What the record says stays the same about this person.
 *
 * Their own words lead, because the field is capped and whichever goes second
 * is what a cap eats; the analyzer's read of the approved face follows. For a
 * person drawn from a description the analyzer only ever sees the portrait, so
 * a tattoo on a forearm can reach the record no other way.
 */
export function keptNotes(
  rec: Pick<PresenterDraftRecord, 'keep'>,
  a: { identityNotes?: string } | undefined,
): string | undefined {
  const keep = rec.keep?.trim();
  const said = keep ? (/[.!?]$/.test(keep) ? keep : `${keep}.`) : '';
  return [said, a?.identityNotes ?? ''].filter(Boolean).join(' ') || undefined;
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
 * The pictures of the details they asked to keep: a tattoo, a scar, a pair of
 * frames. Only the draft holds them; a record keeps the words and the views
 * they were drawn into, so once the draft goes they go with it.
 */
function detailsOf(rec: PresenterDraftRecord): string[] {
  return [...(rec.keepItems ?? []).flatMap((i) => i.refs ?? []), ...Object.values(rec.detailRefs ?? {}).flat()];
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
    // The session's row goes in the same write as the record, as a creation's
    // does: apart, a fault between them left a session that could only 409.
    commit(
      core,
      rec.brandId,
      (json) => {
        if (headOf(json, baseId) !== baseId) throw moved();
        json.characters = brandCharacters(json).map((c: any) => (c.id === base.id ? patched : c));
      },
      rec.id,
    );
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
    stillThere(core, rec.id, [previewHash, avatarHash], hooks);
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
    /**
     * A picture of the face this revision replaces does not come with it.
     *
     * `keptShots` are the record's own shots that claimed no canonical view:
     * a supplementary angle, a curated `left-profile`, the second and third
     * shots of a legacy record. They are appended verbatim to every revision,
     * are never staled (`staleDependents` walks the six views only), never
     * required at save, and never checked against the face. So a person whose
     * identity was changed and reconciled could still be saved carrying a
     * picture of who they used to be, and `characterRefs` boards it into a
     * brief alongside the new views, all of them under "match their face
     * exactly". The set was coherent and the record was not.
     *
     * They carry whenever the face did not move, which is every repair of a
     * single view and every words-only change.
     */
    const faceMoved = rec.views.portrait.hash !== seeded.views.portrait.hash;
    const carried = faceMoved ? [] : kept;
    const minted = carried.length
      ? { ...built.presenter, shots: [...(built.presenter.shots ?? []), ...carried] }
      : built.presenter;
    commit(
      core,
      rec.brandId,
      (json) => {
        if (headOf(json, baseId) !== baseId) throw moved();
        json.characters = [
          ...brandCharacters(json).map((c: any) => (c.id === base.id ? { ...c, supersededBy: minted.id } : c)),
          minted,
        ];
      },
      rec.id,
    );
    head = minted;
  }
  removeUnreferenced(core, [...letGoOf(rec), ...detailsOf(rec)], hooks);
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

/**
 * Stop what is drawing, and keep everything else. The job's own catch writes
 * the outcome on the row (the slot back to what it was, `cancelled` as its
 * reason) and the draft goes idle; nothing is drawn again until asked. The
 * engine gets the abort, so a process under way is killed, not left to spend.
 */
export async function stopPresenterDraft(
  deps: Pick<AssetBuildDeps, 'core'>,
  id: string,
): Promise<PresenterDraftRecord> {
  const rec = getPresenterDraft(deps.core, id);
  if (!rec) throw fail('draft not found', 404);
  const job = running.get(id);
  if (!job) return rec;
  job.ctrl.abort();
  for (let i = 0; i < 500 && running.has(id); i++) await new Promise((r) => setTimeout(r, 10));
  return getPresenterDraft(deps.core, id) ?? rec;
}

/**
 * Intentional cancel: the row goes, and every picture this draft alone was
 * holding. The job is told to stop and stays counted until it has: the
 * update gate reads that count, and a step that has not heard the abort yet
 * is still work in flight.
 */
export async function discardPresenterDraft(
  deps: Pick<AssetBuildDeps, 'core'>,
  id: string,
  hooks: CleanupHooks = {},
): Promise<void> {
  running.get(id)?.ctrl.abort();
  runs.delete(id);
  const rec = getPresenterDraft(deps.core, id);
  if (!rec) return;
  dropDraft(deps.core, rec, hooks);
}

/**
 * A presenter is gone from the brand: let go of what was held on their behalf.
 *
 * Two things outlived a delete. An editing session is a draft row carrying
 * `presenterId`, and it was left behind pointing at a record that no longer
 * exists: its running draw finished and wrote to an orphan, and the row itself
 * sat there until the fourteen-day sweep. And every picture the record held
 * stayed on disk, because this route never let go of anything.
 *
 * Call it after the record has left the brand document, never before: the
 * release scans every brand and every draft for a hash before removing it, and
 * the record it is releasing must not be among them.
 */
export async function releasePresenter(
  deps: AssetBuildDeps,
  brandId: string,
  presenter: { id: string; shots?: { file?: unknown }[]; sourceRefs?: unknown[]; preview?: unknown; avatar?: unknown },
  hooks: CleanupHooks = {},
): Promise<void> {
  for (const d of listPresenterDrafts(deps.core, brandId)) {
    if (d.presenterId === presenter.id) await discardPresenterDraft(deps, d.id, hooks);
  }
  const held = [
    ...(presenter.shots ?? []).map((s) => s?.file),
    ...(presenter.sourceRefs ?? []),
    presenter.preview,
    presenter.avatar,
  ];
  removeUnreferenced(
    deps.core,
    held.map(hashOfFile).filter((h): h is string => !!h),
    hooks,
  );
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
  unreadable.delete(rec.id);
  const generated = PRESENTER_VIEWS.flatMap((v) => {
    const s = rec.views[v];
    return [...s.rejected, ...(s.hash && s.origin === 'generated' ? [s.hash] : []), ...(s.prior ? [s.prior] : [])];
  });
  removeUnreferenced(core, [...generated, ...rec.sources, ...detailsOf(rec)], hooks);
}

/**
 * Remove stored images nothing points at any more: no shot, no brief, no
 * catalog image, no other draft, no brand document. The store is
 * content-addressed, so the same bytes in two places are one file, and one
 * owner is enough to keep it.
 */
export function removeUnreferenced(core: Core, hashes: string[], hooks: CleanupHooks): void {
  const brands = core.store.listBrands().map((b) => JSON.stringify(b.json));
  for (const h of new Set(hashes)) {
    if (!HASH.test(h)) continue;
    if (core.store.imageReferenced(h)) continue;
    if (brands.some((b) => b.includes(h))) continue;
    if (core.images.remove(h)) hooks.evict?.(h);
  }
}
