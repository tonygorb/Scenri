import type { FastifyInstance } from 'fastify';
import type { Core } from '@scenri/core';
import { compareSemver } from '../update/versionsDir.js';

/**
 * First use (DESIGN.md, "First use"): the first shot, made with someone new
 * from the picker to a finished picture, and First steps, where each item is a
 * real task done in the real product. The record is the install's, not a
 * browser's, so a phone on the network and a second browser agree.
 *
 * Who counts as new is decided once, at the first boot of a build that has
 * this record: a home with no brand then is someone who has never used
 * Scenri, and is offered the first shot; a home with brands is someone
 * upgrading, who is never interrupted. The same decision settles What's New:
 * someone new has nothing to compare the running version with, so its notes
 * count as read from that boot.
 *
 * What someone has done is read from what the library holds (a finished shot,
 * a refinement, a product, a presenter, a scene) and latched the first time
 * it is seen, so deleting the thing later never takes the step back.
 */
export const TASKS = ['first-shot', 'refine', 'product', 'presenter', 'scene', 'reuse'] as const;
export type TaskId = (typeof TASKS)[number];
export const MILESTONES = ['shot', 'refine', 'product', 'presenter', 'scene'] as const;
export type Milestone = (typeof MILESTONES)[number];

export interface Counts {
  products: number;
  presenters: number;
  scenes: number;
}

export interface ActiveTask {
  task: TaskId;
  brandId: string;
  /** The database clock when the task began: what it made is what came after. */
  since: string;
  /** How many of each the brand held when the task began: a task that makes one is done when there are more. */
  baseline: Counts;
  /**
   * Its guide was closed part way: nothing is shown until it is continued,
   * and continuing keeps what it began with (the same window of shots, the
   * same presenter draft), which a fresh start would lose.
   */
  paused?: boolean;
}

/**
 * One lesson's own progress: the window its work is counted in, and the
 * milestones it has reached. Every lesson that has been begun and not
 * finished has one of these, which is what lets several be part done at once.
 */
export interface LessonProgress {
  brandId: string;
  /** The database clock when it began: what it made is what came after. */
  since: string;
  /** What the brand held then: a lesson that makes one thing is done when there is one more. */
  baseline: Counts;
  /**
   * The moments this lesson has shown, by their own ids (`go`, `product`,
   * `face`). Stable names rather than a number, because a lesson's steps are
   * resolved against what the product holds now, and a stored index would go
   * stale the moment that changed.
   */
  reached: string[];
  /** Its guide was closed, or another lesson took the screen. Nothing is drawn until it is taken up again. */
  paused?: boolean;
}

interface GuideRecord {
  v: 2;
  eligible: boolean;
  welcome: 'taken' | 'declined' | null;
  /** First steps put away (true) or asked for (false). Unset, it shows only to someone new. */
  hidden: boolean | null;
  done: Partial<Record<Milestone, string>>;
  /**
   * Lessons walked to the end, when each finished. Separate from `done` on
   * purpose: `done` is what the library proves about the product (it is why a
   * tutor never teaches what someone clearly knows), while this is what
   * someone was actually taught. Owning a product is not having taken the
   * lesson about products.
   */
  lessons: Partial<Record<TaskId, string>>;
  dismissed: TaskId[];
  /**
   * Which lesson is guiding right now, and only that: one tutor at a time,
   * because two cards on one screen is nonsense. Progress belongs to the
   * lessons themselves, so taking up another one never costs the first
   * anything but the screen.
   */
  active: TaskId | null;
  progress: Partial<Record<TaskId, LessonProgress>>;
}

export interface TaskNode {
  id: string;
  kind: string;
  status: string;
  images: number;
  createdAt: string;
}

/** What the studio reads: the record, plus what the active task has made so far. */
export interface GuideView {
  eligible: boolean;
  welcome: GuideRecord['welcome'];
  /** Whether First steps stays out of sight: someone not new sees it only after asking for it. */
  hidden: boolean;
  done: GuideRecord['done'];
  /** Which lessons have been walked to the end, and when. */
  lessons: GuideRecord['lessons'];
  dismissed: TaskId[];
  /** The lesson guiding now, as the studio has always read it. */
  active: ActiveTask | null;
  /** Every lesson begun and not finished, each with its own milestones. */
  progress: GuideRecord['progress'];
  /** Shots (or refinements) the active task's brand made since it began, newest first. */
  activeNodes: TaskNode[];
  /** The presenter draft the active presenter task started, when there is one. */
  activeDraftId: string | null;
  /** The active task's brand as it is now, to compare with its baseline. */
  counts: Counts | null;
}

type Store = Core['store'];
const KEY = 'guide';

const isTask = (t: unknown): t is TaskId => (TASKS as readonly unknown[]).includes(t);
const isMilestone = (m: unknown): m is Milestone => (MILESTONES as readonly unknown[]).includes(m);
const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0);

function blank(eligible: boolean): GuideRecord {
  return {
    v: 2,
    eligible,
    welcome: null,
    hidden: null,
    done: {},
    lessons: {},
    dismissed: [],
    active: null,
    progress: {},
  };
}

function parse(raw: string | null): GuideRecord | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (typeof j.eligible !== 'boolean') return null;
    if (j.v !== 2) return null;
    const done: GuideRecord['done'] = {};
    if (j.done && typeof j.done === 'object') {
      for (const [k, at] of Object.entries(j.done)) if (isMilestone(k) && typeof at === 'string') done[k] = at;
    }
    // Added after v2 shipped, so a record written before it simply has none.
    const lessons: GuideRecord['lessons'] = {};
    if (j.lessons && typeof j.lessons === 'object') {
      for (const [k, at] of Object.entries(j.lessons)) if (isTask(k) && typeof at === 'string') lessons[k] = at;
    }
    const asTask = (a: Partial<ActiveTask> | null | undefined): ActiveTask | null => {
      const b = a?.baseline as Partial<Counts> | undefined;
      return a && isTask(a.task) && typeof a.brandId === 'string' && typeof a.since === 'string'
        ? {
            task: a.task,
            brandId: a.brandId,
            since: a.since,
            baseline: { products: num(b?.products), presenters: num(b?.presenters), scenes: num(b?.scenes) },
            ...(a.paused === true ? { paused: true } : {}),
          }
        : null;
    };
    const asProgress = (v: unknown): LessonProgress | null => {
      const p = v as Partial<LessonProgress> | null | undefined;
      const b = p?.baseline as Partial<Counts> | undefined;
      return p && typeof p.brandId === 'string' && typeof p.since === 'string'
        ? {
            brandId: p.brandId,
            since: p.since,
            baseline: { products: num(b?.products), presenters: num(b?.presenters), scenes: num(b?.scenes) },
            reached: Array.isArray(p.reached) ? p.reached.filter((m): m is string => typeof m === 'string') : [],
            ...(p.paused === true ? { paused: true } : {}),
          }
        : null;
    };
    const progress: GuideRecord['progress'] = {};
    if (j.progress && typeof j.progress === 'object') {
      for (const [k, v] of Object.entries(j.progress)) {
        const p = asProgress(v);
        if (isTask(k) && p) progress[k] = p;
      }
    }
    /**
     * Records written before a lesson owned its own progress: one task in
     * hand, and later a shelf of set-down ones beside it. Both are lessons
     * part done, so both become progress and nothing already begun is lost.
     */
    if (j.parked && typeof j.parked === 'object') {
      for (const [k, v] of Object.entries(j.parked)) {
        const t = asTask(v as Partial<ActiveTask>);
        if (isTask(k) && t && !progress[k]) progress[k] = { ...t, reached: [], paused: true };
      }
    }
    const a = j.active as Partial<ActiveTask> | null | undefined;
    const b = a?.baseline as Partial<Counts> | undefined;
    const held: ActiveTask | null =
      a && isTask(a.task) && typeof a.brandId === 'string' && typeof a.since === 'string'
        ? {
            task: a.task,
            brandId: a.brandId,
            since: a.since,
            baseline: { products: num(b?.products), presenters: num(b?.presenters), scenes: num(b?.scenes) },
            ...(a.paused === true ? { paused: true } : {}),
          }
        : null;
    return {
      v: 2,
      eligible: j.eligible,
      welcome: j.welcome === 'taken' || j.welcome === 'declined' ? j.welcome : null,
      hidden: typeof j.hidden === 'boolean' ? j.hidden : null,
      done,
      lessons,
      dismissed: Array.isArray(j.dismissed) ? j.dismissed.filter(isTask) : [],
      // an old record's one task in hand is that lesson's progress now
      active: typeof j.active === 'string' && isTask(j.active) ? j.active : (held?.task ?? null),
      progress: held && !progress[held.task] ? { ...progress, [held.task]: { ...held, reached: [] } } : progress,
    };
  } catch {
    return null;
  }
}

function write(store: Store, r: GuideRecord): void {
  store.setSetting(KEY, JSON.stringify(r));
}

/**
 * The boot decision. Idempotent: only a home with no record at all is judged.
 * A new home's notes are marked read before the record is written, because the
 * record is what stops this running again: a boot that dies between the two
 * writes is judged once more rather than left announcing its own install.
 */
export function stampGuide(store: Store, version: string): void {
  if (store.getSetting(KEY) !== null) return;
  const eligible = store.listBrands().length === 0;
  if (eligible) {
    if (!store.getSetting('install.firstVersion')) store.setSetting('install.firstVersion', version);
    const seen = store.getSetting('whatsnew.seen');
    if (!seen || compareSemver(seen, version) < 0) store.setSetting('whatsnew.seen', version);
  }
  write(store, blank(eligible));
}

/** A brand's own presenters, scenes and products, counted the way the studio lists them. */
export function countsOf(core: Core, brandId: string): Counts | null {
  const brand = core.store.getBrand(brandId);
  if (!brand) return null;
  const json = brand.json as any;
  const characters: any[] = Array.isArray(json?.characters) ? json.characters : [];
  return {
    presenters: characters.filter((c) => c?.origin === 'custom' && !c?.supersededBy).length,
    scenes: Array.isArray(json?.scenes) ? json.scenes.length : 0,
    products: core.catalog.listLibraryProducts(brandId, json).length,
  };
}

const ownPresenter = (b: { json: unknown }) =>
  ((b.json as any)?.characters ?? []).some((c: any) => c?.origin === 'custom' && !c?.supersededBy);

/** What the library proves has been done at least once, across every brand. */
function evidence(core: Core, m: Milestone): boolean {
  const { store } = core;
  switch (m) {
    case 'shot':
      return store.hasFinishedNode('generation');
    case 'refine':
      return store.hasFinishedNode('edit');
    case 'presenter':
      return store.listBrands().some(ownPresenter);
    case 'scene':
      return store.listBrands().some((b) => ((b.json as any)?.scenes ?? []).length > 0);
    case 'product':
      return store.hasCatalogProduct() || store.listBrands().some((b) => ((b.json as any)?.products ?? []).length > 0);
  }
}

function load(store: Store): GuideRecord {
  return parse(store.getSetting(KEY)) ?? blank(false);
}

/**
 * The record as the studio reads it. Latches anything the library now proves,
 * and lets go of a task whose brand is gone. `SCENRI_NO_GUIDE` silences the
 * boot decision for test rigs; a task someone starts still runs.
 */
export function readGuide(core: Core, env: NodeJS.ProcessEnv): GuideView {
  const r = load(core.store);
  let changed = false;
  const at = new Date().toISOString();
  for (const m of MILESTONES) {
    if (!r.done[m] && evidence(core, m)) {
      r.done[m] = at;
      changed = true;
    }
  }
  // a brand that is gone takes its lessons' work with it, though not what
  // those lessons taught: that is in `lessons`, and stays
  for (const [t, p] of Object.entries(r.progress)) {
    if (core.store.getBrand(p.brandId)) continue;
    delete r.progress[t as TaskId];
    if (r.active === t) r.active = null;
    changed = true;
  }
  if (changed) write(core.store, r);

  // The lesson guiding now, in the shape the studio has always read.
  const on = r.active ? r.progress[r.active] : null;
  const a: ActiveTask | null =
    r.active && on
      ? {
          task: r.active,
          brandId: on.brandId,
          since: on.since,
          baseline: on.baseline,
          ...(on.paused ? { paused: true } : {}),
        }
      : null;
  const nodeKind =
    a?.task === 'first-shot' || a?.task === 'reuse' ? 'generation' : a?.task === 'refine' ? 'edit' : null;
  // 0.11.1 and 0.12.0 stamped fresh installs new while first use was switched
  // off, and those installs were then used for real. Someone who has made a
  // shot and never answered the welcome is not new: nothing opens or starts by
  // itself for them, and Learn is still theirs to open.
  const settled = r.welcome === null && !!r.done.shot;
  const eligible = r.eligible && !settled && env.SCENRI_NO_GUIDE !== '1';
  return {
    eligible,
    welcome: r.welcome,
    hidden: r.hidden ?? !eligible,
    done: r.done,
    lessons: r.lessons,
    dismissed: r.dismissed,
    active: a,
    progress: r.progress,
    activeNodes: a && nodeKind ? core.store.nodesSince(a.brandId, nodeKind, a.since) : [],
    activeDraftId: a?.task === 'presenter' ? core.store.presenterDraftSince(a.brandId, a.since) : null,
    counts: a ? countsOf(core, a.brandId) : null,
  };
}

/** Applies one intent. Returns what is wrong with a request that makes no sense, else null. */
export function applyIntent(core: Core, body: unknown): string | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const r = load(core.store);
  if ('welcome' in b) {
    if (b.welcome !== 'taken' && b.welcome !== 'declined') return 'welcome is taken or declined';
    r.welcome = b.welcome;
  } else if ('start' in b) {
    const s = (b.start ?? {}) as Record<string, unknown>;
    if (!isTask(s.task)) return 'unknown task';
    if (typeof s.brandId !== 'string') return 'brandId required';
    const baseline = countsOf(core, s.brandId);
    if (!baseline) return 'brand not found';
    // Whatever was guiding is set down, never thrown away: its own progress
    // is its own, and the only thing it loses is the screen.
    const guiding = r.active ? r.progress[r.active] : null;
    if (r.active && r.active !== s.task && guiding) r.progress[r.active] = { ...guiding, paused: true };
    // This lesson, part done in this brand, is taken up where it was left.
    const mine = r.progress[s.task];
    if (mine && mine.brandId === s.brandId) {
      const { paused: _, ...going } = mine;
      r.progress[s.task] = going;
    } else r.progress[s.task] = { brandId: s.brandId, since: core.store.now(), baseline, reached: [] };
    r.active = s.task;
    r.dismissed = r.dismissed.filter((t) => t !== s.task);
  } else if ('finish' in b) {
    if (!isTask(b.finish)) return 'unknown task';
    // Walked to the end, so the lesson is taught: kept even if what it made
    // is deleted later, and never set by anything but finishing it.
    if (!r.lessons[b.finish]) r.lessons[b.finish] = new Date().toISOString();
    if (r.active === b.finish) r.active = null;
    // done is done: taken again, it begins a fresh window at its first step
    delete r.progress[b.finish];
  } else if ('dismiss' in b) {
    if (!isTask(b.dismiss)) return 'unknown task';
    if (!r.dismissed.includes(b.dismiss)) r.dismissed.push(b.dismiss);
    // Closing the guide sets that lesson down: its progress stands, and
    // nothing is guiding until something is taken up again.
    const shut = r.progress[b.dismiss];
    if (shut) r.progress[b.dismiss] = { ...shut, paused: true };
    if (r.active === b.dismiss) r.active = null;
  } else if ('reached' in b) {
    const w = (b.reached ?? {}) as Record<string, unknown>;
    if (!isTask(w.task)) return 'unknown task';
    if (typeof w.moment !== 'string' || !w.moment) return 'moment required';
    const p = r.progress[w.task];
    // Only a lesson that is under way records anything, and each milestone
    // once: this is a note of what has been seen, not a log of every render.
    if (!p) return null;
    if (p.reached.includes(w.moment)) return null;
    r.progress[w.task] = { ...p, reached: [...p.reached, w.moment].slice(-24) };
  } else if ('hidden' in b) {
    if (typeof b.hidden !== 'boolean') return 'hidden is true or false';
    r.hidden = b.hidden;
  } else return 'unknown intent';
  write(core.store, r);
  return null;
}

export function registerGuideRoutes(
  app: FastifyInstance,
  deps: { core: Core; version: string; env?: NodeJS.ProcessEnv },
): void {
  const { core } = deps;
  const env = deps.env ?? process.env;
  stampGuide(core.store, deps.version);

  app.get('/api/guide', async () => readGuide(core, env));

  app.post('/api/guide', async (req, reply) => {
    const error = applyIntent(core, req.body);
    if (error) return reply.status(400).send({ error });
    return readGuide(core, env);
  });
}
