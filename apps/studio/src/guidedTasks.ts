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
 * One guide, everywhere. A coach holds the screen it is on (the page, the
 * presenter studio, a creation dialog, the open shot): a curtain with windows
 * on the live surfaces and a card pointing at what matters. A card points at
 * something that just happened without holding anything. Quiet is a task
 * still in hand with nothing drawn, while the surface speaks for itself, such
 * as the presenter studio's own questions.
 */
export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface GuideAction {
  kind: 'close-picker' | 'done';
  label: string;
}

export interface Guidance {
  /** Stable, for the Back history and the tests. */
  id: string;
  voice: 'coach' | 'card' | 'quiet';
  /** What the card points at. */
  target?: string;
  /** coach: what stays live while the screen is held. The windows are drawn from the shapes inside it. */
  surfaces?: string[];
  /** The surface that owns the screen, when it is not the page: the guide is drawn inside it. */
  container?: string;
  side?: Side;
  /** The card sits beside its target where there is room (right, then left), and above it where there is not. */
  beside?: boolean;
  title?: string;
  body?: string;
  /** The card's one button. */
  action?: GuideAction;
  /** Finished: the X and Done both end the task as done. */
  done?: boolean;
  /** The X only puts this card away until the step changes. */
  snooze?: boolean;
  /** quiet: said once to a screen reader. */
  announce?: string;
}

/** Create's composer: its tray, its card and its picker. */
const COMPOSE = '[data-guide="compose"]';
const PICKER = '[data-guide="compose"] .sc-attachpanel';

export const COPY = {
  engine: {
    title: 'Connect image generation',
    body: 'Your first shot needs it. The rest of Scenri works meanwhile.',
  },
  add: {
    title: 'Every shot starts from ingredients',
    body: "Scenri keeps products, presenters and scenes so you never describe them twice. Start with what you're shooting.",
  },
  pick: {
    title: "A product is what you're shooting",
    body: 'Its real photos keep it exact in every shot. Pick one of yours or one of ours.',
  },
  pickedProduct: {
    title: 'Add who appears, or where',
    body: 'A presenter is the same person in every shot; a scene is the world and its light. Both are optional.',
  },
  pickedOther: {
    title: "Add what they're showing",
    body: 'A product keeps its real photos exact. You can carry on without one.',
  },
  pickedAll: {
    title: "That's a shot's ingredients",
    body: 'Next, a few words of direction.',
  },
  direct: {
    title: 'Now direct it',
    body: 'A few words for the place, the light and the moment. The ingredients already carry how things look.',
  },
  generate: {
    title: 'Make the shot',
    body: 'Scenri composes your ingredients and direction into one shot.',
  },
  waiting: {
    title: 'Your shot is being made',
    body: 'Every shot keeps its ingredients, so you can change one thing later without starting over.',
  },
  failed: {
    title: "That one didn't finish",
    body: 'The tile says why. Your ingredients and words are still in the brief.',
  },
  result: {
    title: 'Your first shot',
    body: 'Open it and say what to change. Everything else stays as it is.',
  },
  refineAsk: {
    title: 'Change one thing at a time',
    body: 'Like warmer light or a closer crop. The rest of the shot stays.',
  },
  refineResult: {
    title: 'This is a new version',
    body: 'The original is one step back.',
  },
  product: {
    title: "A product is what you're shooting",
    body: 'A few real photos keep it exact in every shot, or import your store below.',
  },
  presenterIntro: {
    title: 'A presenter is who appears',
    body: 'Cast someone once and the same face fronts every shot. Describe someone new, or start from photos of a real person.',
  },
  presenterFace: {
    title: 'Settle the face first',
    body: 'Every shot with this presenter uses it. Use it, try again, or say what to change.',
  },
  presenterSave: {
    title: 'Save to cast them',
    body: "Once saved, they're in the ingredients for every shot.",
  },
  scene: {
    title: 'A scene is the world a shot lives in',
    body: 'Its place and light carry into every shot that uses it. Photos of a real place work best; a line of direction works too.',
  },
  continue: 'Continue',
} as const;

const tile = (id: string) => `.sc-feed .sc-cell[data-fb-node="${id}"]`;
const finished = (n: GuideTaskNode) => n.status === 'done' && n.images > 0;
const failed = (n: GuideTaskNode) =>
  n.status === 'error' || n.status === 'cancelled' || (n.status === 'done' && n.images === 0);

/** Everything in the brief that is an ingredient rather than words. */
export const ingredientsOf = (c: ComposerFacts) => c.products + c.presenters + (c.scene ? 1 : 0) + c.others;

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
  if (done) return { id: 'result', voice: 'card', target: tile(done.id), side: 'bottom', ...COPY.result, done: true };
  if (c?.busy) return { id: 'sending', voice: 'quiet' };
  const running = f.nodes.find((n) => n.status === 'running');
  if (running)
    return {
      id: 'waiting',
      voice: 'card',
      target: tile(running.id),
      side: 'bottom',
      ...COPY.waiting,
      snooze: true,
      announce: COPY.waiting.title,
    };
  const ingredients = c ? ingredientsOf(c) : 0;
  const building = !!c && (c.pickerOpen || ingredients > 0 || c.words);
  const lastFailed = f.nodes.find(failed);
  if (lastFailed && !building)
    return { id: 'failed', voice: 'card', target: tile(lastFailed.id), side: 'bottom', ...COPY.failed };
  if (!c || c.refining) return null;
  const coach = (id: string, target: string, copy: { title: string; body: string }): Guidance => ({
    id,
    voice: 'coach',
    target,
    surfaces: [COMPOSE],
    side: 'top',
    ...copy,
  });
  if (c.engine !== 'ready') return coach('engine', '[data-guide="compose.engine"]', COPY.engine);
  if (c.pickerOpen) {
    const inPicker = (id: string, copy: { title: string; body: string }, more = false): Guidance => ({
      ...coach(id, PICKER, copy),
      beside: true,
      ...(more ? { action: { kind: 'close-picker', label: COPY.continue } } : {}),
    });
    if (ingredients === 0) return inPicker('pick', COPY.pick);
    if (c.products > 0 && c.presenters > 0 && c.scene) return inPicker('picked-all', COPY.pickedAll, true);
    if (c.products > 0) return inPicker('picked-product', COPY.pickedProduct, true);
    return inPicker('picked-other', COPY.pickedOther, true);
  }
  if (ingredients === 0) return coach('add', '[data-guide="compose.add"]', COPY.add);
  if (!c.words) return coach('direct', '[data-guide="compose"] .sc-brief-line', COPY.direct);
  return coach('generate', '[data-guide="compose.send"]', COPY.generate);
}

/** The steps Back can show again: the ones that point at a control, never a surface that opened or a result. */
export const REVIEWABLE: readonly string[] = ['engine', 'add', 'direct', 'generate'];

export interface RefineFacts {
  /** A shot's overlay is open, in the task's brand. */
  here: boolean;
  nodes: readonly GuideTaskNode[];
}

/** The open shot's composer: where a change is asked for. */
const SHOT = '.sc-ovl';
const SHOT_COMPOSER = '.sc-ovl .sc-promptcard';

/** Refining a shot: one change, then the new version. */
export function refineStep(f: RefineFacts): Guidance | null {
  if (!f.here) return null;
  if (f.nodes.find(finished))
    return {
      id: 'refined',
      voice: 'card',
      container: SHOT,
      target: SHOT_COMPOSER,
      beside: true,
      ...COPY.refineResult,
      done: true,
    };
  if (f.nodes.some((n) => n.status === 'running')) return { id: 'refining', voice: 'quiet' };
  if (f.nodes.length && f.nodes.every(failed)) return { id: 'refine-failed', voice: 'quiet' };
  return {
    id: 'ask',
    voice: 'coach',
    container: SHOT,
    target: SHOT_COMPOSER,
    surfaces: [SHOT_COMPOSER],
    beside: true,
    ...COPY.refineAsk,
  };
}

/**
 * A presenter: a word as the studio opens, at the face everything else is
 * drawn from, and at the save that puts them in the ingredients. Every other
 * question is the studio's own, and the guide stays quiet through it, on both
 * the photos and the from-scratch roads.
 */
export function presenterStep(studio: StudioFacts | null): Guidance | null {
  if (!studio) return null;
  const turn = `.sc-pstudio [data-turn="q:${studio.open}"]`;
  const coach = (id: string, copy: { title: string; body: string }, more: string[] = []): Guidance => ({
    id,
    voice: 'coach',
    container: '.sc-pstudio',
    target: turn,
    // the question and the composer that can answer it stay live; the rest of the conversation waits
    surfaces: [turn, '.sc-pstudio-foot .sc-convo-card', ...more],
    beside: true,
    ...copy,
  });
  switch (studio.open) {
    case 'source':
      return coach('intro', COPY.presenterIntro);
    case 'identity':
    case 'revision':
      return coach('face', COPY.presenterFace, ['.sc-pstudio-well']);
    case 'save':
    case 'blind':
      return coach('save', COPY.presenterSave);
    default:
      return { id: 'studio', voice: 'quiet' };
  }
}

/** A product or a scene: the dialog it is made in, held, then quiet until it exists. */
export function assetStep(task: 'product' | 'scene', dialogOpen: boolean): Guidance | null {
  if (!dialogOpen) return null;
  return {
    id: task,
    voice: 'coach',
    container: '.sc-newdlg-layer',
    target: '.sc-newdlg',
    surfaces: ['.sc-newdlg'],
    beside: true,
    ...(task === 'product' ? COPY.product : COPY.scene),
  };
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
 * Whether someone new opening a surface on their own begins its task. Only
 * once (not done, not closed), only with First steps still wanted. A task
 * left in hand on another surface gives way, so an abandoned dialog never
 * blocks the next thing; the first shot never does. Tasks never chain: the
 * caller only asks when the person has engaged with the surface.
 */
export function startsHere(task: GuideTaskId, s: ContextStart): boolean {
  if (!s.eligible || s.hidden) return false;
  if (s.active && (s.active.task === task || s.active.task === 'first-shot')) return false;
  if (s.done[MILESTONE[task]] || s.dismissed.includes(task)) return false;
  if (task === 'refine' && !s.done.shot) return false;
  return true;
}

export interface StepRow {
  task: GuideTaskId;
  title: string;
  /** One short line on why the step matters, or what it waits for. */
  why: string;
  state: 'todo' | 'active' | 'done';
}

const ROWS: { task: GuideTaskId; title: string; why: string; resume: string }[] = [
  {
    task: 'first-shot',
    title: 'Make your first shot',
    why: 'Ingredients become a shot',
    resume: 'Continue your first shot',
  },
  { task: 'refine', title: 'Refine a shot', why: 'Change one thing, keep the rest', resume: 'Continue refining' },
  { task: 'product', title: 'Add your own product', why: 'Real photos keep it exact', resume: 'Continue your product' },
  {
    task: 'presenter',
    title: 'Cast a presenter',
    why: 'The same person in every shot',
    resume: 'Continue your presenter',
  },
  { task: 'scene', title: 'Build a scene', why: 'A world you shoot in again', resume: 'Continue your scene' },
];

/** First steps, or null when it has nothing to say or was put away. */
export function firstSteps(
  view: Pick<GuideView, 'hidden' | 'done' | 'active'> & { loaded: boolean; asked?: boolean },
): StepRow[] | null {
  if (!view.loaded || view.hidden) return null;
  const rows = ROWS.map((r): StepRow => {
    const state = view.done[MILESTONE[r.task]] ? 'done' : view.active?.task === r.task ? 'active' : 'todo';
    return {
      task: r.task,
      title: state === 'active' ? r.resume : r.title,
      // Refining needs a shot to refine: said, rather than quietly starting something else.
      why: r.task === 'refine' && state === 'todo' && !view.done.shot ? 'Starts from your first shot' : r.why,
      state,
    };
  });
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
