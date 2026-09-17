import type { GuideTaskId, GuideTaskNode, GuideView, ShowcaseEntry } from './apiTypes.js';
import type { ComposerFacts, StudioFacts } from './guideFacts.js';

/**
 * First use, as rules (DESIGN.md, "First use"). A guided task helps someone do
 * one real thing to a real result: make a first shot, refine it, keep a
 * product, cast a presenter, build a scene. What the guide says is always
 * derived from what the product holds right now, never counted: a step is the
 * first of these rules that is true, checked from the outcome back, so a send
 * that empties the brief never sends the guide back to the start.
 *
 * Three voices. A coach step holds the page (only its surfaces stay live) and
 * points at the one thing to do; it is used only for the first shot. A card
 * points at something without holding anything. A note is one sentence in a
 * slot the surface already has. Everything else is quiet: the task stays in
 * hand and nothing is drawn.
 */
export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface Guidance {
  /** Stable, for the Back history and the tests. */
  id: string;
  voice: 'coach' | 'card' | 'note' | 'quiet';
  /** coach and card: the control the card points at. */
  target?: string;
  /** coach and note: the slot the sentence sits in, when it sits inside a surface. */
  slot?: string;
  /** coach: what stays live and open while the page is held. */
  surfaces?: string[];
  side?: Side;
  title?: string;
  body?: string;
  /** The card ends the task with Done. */
  done?: boolean;
  /** quiet: said once to a screen reader. */
  announce?: string;
}

/** Create's composer, with its tray. */
const DOCK = '[data-guide="compose"]';
/** Its picker: inside the composer, but drawn above it, so the window has to reach it too. */
const PICKER = '[data-guide="compose"] .sc-attachpanel';

export const COPY = {
  engine: {
    title: 'Connect image generation',
    body: 'Your first shot needs it. The rest of Scenri works meanwhile.',
  },
  add: {
    title: "Add what you're shooting",
    body: "Every shot starts from real references. Scenri's own products are ready now.",
  },
  pick: 'Choose a product. Its real photos keep it exact in every shot.',
  picked: 'Add a presenter or a scene if you like, then close the panel to direct the shot.',
  brief: {
    title: 'Direct it, then Generate',
    body: 'A few words for the place, the light and the moment. The product already carries its look.',
  },
  waiting: 'Your first shot is on its way.',
  failed: "That one didn't finish. The tile says why, and trying again keeps your product and words.",
  result: {
    title: 'Your first shot',
    body: 'Open it and say what to change. The rest of the shot stays as it is.',
  },
  refineAsk: 'One change at a time works best, like warmer light or a closer crop.',
  refineResult: 'This is a new version. The original is one step back.',
  product: 'Photos of the real product keep it exact in every shot, or import your store below.',
  presenterStart: 'Cast them once, and the same person fronts every shot.',
  presenterFace: 'Every shot will use this face, so settle it here.',
  scene: 'Build a place once and shoot in it again. Photos of a real place work best; a line of direction works too.',
} as const;

const tile = (id: string) => `.sc-feed .sc-cell[data-fb-node="${id}"]`;
const finished = (n: GuideTaskNode) => n.status === 'done' && n.images > 0;
const failed = (n: GuideTaskNode) =>
  n.status === 'error' || n.status === 'cancelled' || (n.status === 'done' && n.images === 0);

export interface ShotFacts {
  /** On the brand's Create page, the task's brand, with nothing modal over it. */
  here: boolean;
  composer: ComposerFacts | null;
  /** What the task has sent, newest first. */
  nodes: readonly GuideTaskNode[];
}

/** The first shot, from the outcome back to the first thing to do. */
export function firstShotStep(f: ShotFacts): Guidance | null {
  if (!f.here) return null;
  const c = f.composer;
  const done = f.nodes.find(finished);
  if (done)
    return {
      id: 'result',
      voice: 'card',
      target: tile(done.id),
      side: 'bottom',
      title: COPY.result.title,
      body: COPY.result.body,
      done: true,
    };
  if (c?.busy) return { id: 'sending', voice: 'quiet' };
  if (f.nodes.some((n) => n.status === 'running')) return { id: 'waiting', voice: 'quiet', announce: COPY.waiting };
  const building = !!c && (c.pickerOpen || c.products > 0 || c.presenters > 0 || c.scene || c.words);
  const lastFailed = f.nodes.find(failed);
  if (lastFailed && !building)
    return { id: 'failed', voice: 'card', target: tile(lastFailed.id), side: 'bottom', body: COPY.failed };
  if (!c || c.refining) return null;
  if (c.engine !== 'ready')
    return {
      id: 'engine',
      voice: 'coach',
      target: '[data-guide="compose.engine"]',
      surfaces: [DOCK],
      side: 'top',
      ...COPY.engine,
    };
  if (c.pickerOpen)
    return {
      id: c.products > 0 ? 'picked' : 'pick',
      voice: 'coach',
      slot: 'picker',
      surfaces: [DOCK, PICKER],
      body: c.products > 0 ? COPY.picked : COPY.pick,
    };
  if (c.products === 0)
    return {
      id: 'add',
      voice: 'coach',
      target: '[data-guide="compose.add"]',
      surfaces: [DOCK],
      side: 'top',
      ...COPY.add,
    };
  return {
    id: 'brief',
    voice: 'coach',
    target: '[data-guide="compose.send"]',
    surfaces: [DOCK],
    side: 'top',
    ...COPY.brief,
  };
}

export interface RefineFacts {
  /** A finished shot's overlay is open, in the task's brand. */
  here: boolean;
  nodes: readonly GuideTaskNode[];
}

/** Refining a shot: one change, then the new version. */
export function refineStep(f: RefineFacts): Guidance | null {
  if (!f.here) return null;
  if (f.nodes.find(finished))
    return { id: 'refined', voice: 'note', slot: 'tray:overlay', body: COPY.refineResult, done: true };
  if (f.nodes.some((n) => n.status === 'running')) return { id: 'refining', voice: 'quiet' };
  if (f.nodes.length && f.nodes.every(failed)) return { id: 'refine-failed', voice: 'quiet' };
  return { id: 'ask', voice: 'note', slot: 'tray:overlay', body: COPY.refineAsk };
}

/** A presenter: quiet through the studio's own questions, a word at the start and at the face. */
export function presenterStep(studio: StudioFacts | null): Guidance | null {
  if (!studio) return null;
  if (studio.open === 'source') return { id: 'cast', voice: 'note', slot: 'studio', body: COPY.presenterStart };
  if (studio.open === 'identity') return { id: 'face', voice: 'note', slot: 'studio', body: COPY.presenterFace };
  return { id: 'studio', voice: 'quiet' };
}

/** A product or a scene: a word in its dialog, then quiet until it exists. */
export function assetStep(task: 'product' | 'scene', dialogOpen: boolean): Guidance | null {
  if (!dialogOpen) return null;
  return { id: task, voice: 'note', slot: `dialog:${task}`, body: task === 'product' ? COPY.product : COPY.scene };
}

/** The tasks that end on their own, when the brand holds one more than it did. */
export function madeOne(
  view: Pick<GuideView, 'active' | 'counts'>,
  now: { products: number; presenters: number; scenes: number },
): boolean {
  const a = view.active;
  if (!a) return false;
  if (a.task === 'product') return now.products > a.baseline.products;
  if (a.task === 'presenter') return now.presenters > a.baseline.presenters;
  if (a.task === 'scene') return now.scenes > a.baseline.scenes;
  return false;
}

export interface ContextStart {
  eligible: boolean;
  hidden: boolean;
  done: GuideView['done'];
  dismissed: readonly GuideTaskId[];
  active: GuideView['active'];
}

const MILESTONE: Record<GuideTaskId, keyof GuideView['done']> = {
  'first-shot': 'shot',
  refine: 'refine',
  product: 'product',
  presenter: 'presenter',
  scene: 'scene',
};

/**
 * Whether someone's own first visit to a surface begins its task. Only for
 * someone new, only once (not done, not dismissed), only with First steps
 * still wanted and nothing else in hand. Tasks never chain on their own.
 */
export function startsHere(task: GuideTaskId, s: ContextStart): boolean {
  if (!s.eligible || s.hidden || s.active) return false;
  if (s.done[MILESTONE[task]] || s.dismissed.includes(task)) return false;
  if (task === 'refine' && !s.done.shot) return false;
  return true;
}

export interface StepRow {
  task: GuideTaskId;
  label: string;
  state: 'todo' | 'active' | 'done';
}

const ROWS: [GuideTaskId, string][] = [
  ['first-shot', 'Make a shot'],
  ['refine', 'Refine a shot'],
  ['product', 'Add your product'],
  ['presenter', 'Cast a presenter'],
  ['scene', 'Build a scene'],
];

/** First steps, or null when it has nothing to say or was put away. */
export function firstSteps(
  view: Pick<GuideView, 'hidden' | 'eligible' | 'welcome' | 'done' | 'active'> & { loaded: boolean; asked?: boolean },
): StepRow[] | null {
  if (!view.loaded || view.hidden) return null;
  // Someone new meets the welcome first; First steps is what follows it, unless they ask for it.
  if (view.eligible && view.welcome === null && !view.asked) return null;
  const rows = ROWS.map(
    ([task, label]): StepRow => ({
      task,
      label,
      state: view.done[MILESTONE[task]] ? 'done' : view.active?.task === task ? 'active' : 'todo',
    }),
  );
  // Done with everything, it leaves; asked for from Help, it stays so any step can be done again.
  return rows.every((r) => r.state === 'done') && !view.asked ? null : rows;
}

export interface WelcomeInput {
  onMainPage: boolean;
  eligible: boolean;
  welcome: GuideView['welcome'];
  ready: boolean;
  visible: boolean;
  /** Something else owns the screen. */
  blocked: boolean;
  /** A shot is generating or an asset is building (an import running in the background does not count). */
  busy: boolean;
}

export function canWelcome(i: WelcomeInput): boolean {
  return i.onMainPage && i.eligible && i.welcome === null && i.ready && i.visible && !i.blocked && !i.busy;
}

/** The welcome's words, here so the copy rules cover them with every step. */
export const WELCOME = {
  lede: 'Product shots on brand, from your products, presenters, scenes and brand kit.',
  take: 'Make your first shot',
  notNow: 'Not now',
  note: (i: { engineReady: boolean; ownsProducts: boolean }) =>
    !i.engineReady
      ? 'It starts with a short setup for image generation.'
      : i.ownsProducts
        ? 'Start with one of your products. It takes a few minutes.'
        : 'Start with a product of ours. It takes a few minutes.',
} as const;

/**
 * The welcome's three pictures: one product shot in three worlds, the studio's
 * promise in a row. The first product in wall order with three examples in
 * different scenes wins; failing that, three of one product; failing that, the
 * first three pictures.
 */
export function welcomeSet(showcase: readonly ShowcaseEntry[]): ShowcaseEntry[] {
  const withPictures = showcase.filter((e) => e.previewUrl);
  const token = (e: ShowcaseEntry, kind: string) =>
    (e.brief?.tokens ?? []).find((t: { t?: string; id?: string }) => t?.t === kind)?.id as string | undefined;
  const byProduct = new Map<string, ShowcaseEntry[]>();
  for (const e of withPictures) {
    const p = token(e, 'product');
    if (!p) continue;
    byProduct.set(p, [...(byProduct.get(p) ?? []), e]);
  }
  for (const group of byProduct.values()) {
    const worlds = new Map<string, ShowcaseEntry>();
    for (const e of group) {
      const scene = token(e, 'template');
      if (scene && !worlds.has(scene)) worlds.set(scene, e);
    }
    if (worlds.size >= 3) return [...worlds.values()].slice(0, 3);
  }
  for (const group of byProduct.values()) if (group.length >= 3) return group.slice(0, 3);
  return withPictures.slice(0, 3);
}

/** Merges what the activity stream says into what the server said the task has made. */
export function mergeTaskNodes(
  known: readonly GuideTaskNode[],
  records: readonly { id: string; kind: string; status: string; images?: unknown[]; createdAt: string }[],
  since: string,
  kind: 'generation' | 'edit',
): GuideTaskNode[] {
  const byId = new Map(known.map((n) => [n.id, n]));
  let changed = false;
  for (const r of records) {
    if (r.kind !== kind || r.createdAt < since) continue;
    const next: GuideTaskNode = {
      id: r.id,
      kind: r.kind,
      status: r.status,
      images: Array.isArray(r.images) ? r.images.length : 0,
      createdAt: r.createdAt,
    };
    const prev = byId.get(r.id);
    if (prev && prev.status === next.status && prev.images === next.images) continue;
    byId.set(r.id, next);
    changed = true;
  }
  if (!changed) return known as GuideTaskNode[];
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
