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
export const TASKS = ['first-shot', 'refine', 'product', 'presenter', 'scene'] as const;
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

interface GuideRecord {
  v: 2;
  eligible: boolean;
  welcome: 'taken' | 'declined' | null;
  /** First steps put away (true) or asked for (false). Unset, it shows only to someone new. */
  hidden: boolean | null;
  done: Partial<Record<Milestone, string>>;
  dismissed: TaskId[];
  active: ActiveTask | null;
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
  dismissed: TaskId[];
  active: ActiveTask | null;
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
  return { v: 2, eligible, welcome: null, hidden: null, done: {}, dismissed: [], active: null };
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
    const a = j.active as Partial<ActiveTask> | null | undefined;
    const b = a?.baseline as Partial<Counts> | undefined;
    const active: ActiveTask | null =
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
      dismissed: Array.isArray(j.dismissed) ? j.dismissed.filter(isTask) : [],
      active,
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
  if (r.active && !core.store.getBrand(r.active.brandId)) {
    r.active = null;
    changed = true;
  }
  if (changed) write(core.store, r);

  const a = r.active;
  const nodeKind = a?.task === 'first-shot' ? 'generation' : a?.task === 'refine' ? 'edit' : null;
  const eligible = r.eligible && env.SCENRI_NO_GUIDE !== '1';
  return {
    eligible,
    welcome: r.welcome,
    hidden: r.hidden ?? !eligible,
    done: r.done,
    dismissed: r.dismissed,
    active: a,
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
    const held = r.active;
    // The same task, paused in the same brand, is continued rather than begun again.
    if (held && held.paused && held.task === s.task && held.brandId === s.brandId) {
      const { paused: _, ...going } = held;
      r.active = going;
    } else r.active = { task: s.task, brandId: s.brandId, since: core.store.now(), baseline };
    r.dismissed = r.dismissed.filter((t) => t !== s.task);
  } else if ('finish' in b) {
    if (!isTask(b.finish)) return 'unknown task';
    if (r.active?.task === b.finish) r.active = null;
  } else if ('dismiss' in b) {
    if (!isTask(b.dismiss)) return 'unknown task';
    if (!r.dismissed.includes(b.dismiss)) r.dismissed.push(b.dismiss);
    // Closing the guide pauses its task: still in hand, said nothing about, continued as it was.
    if (r.active?.task === b.dismiss) r.active = { ...r.active, paused: true };
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
