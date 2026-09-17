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
  /** close-picker closes the open picker; confirm says the step is done; done ends the task. */
  kind: 'close-picker' | 'confirm' | 'done';
  label: string;
  /** Shown, but waiting for what the step asks for first. */
  disabled?: boolean;
}

/** One ingredient a first shot asks for, ticked when the brief holds it. */
export interface GuideCheck {
  id: 'product' | 'presenter' | 'scene';
  label: string;
  done: boolean;
}

export interface Guidance {
  /** Stable, for the Back history and the tests. */
  id: string;
  voice: 'coach' | 'card' | 'quiet';
  /** What the card points at. */
  target?: string;
  /** coach: what the curtain leaves open to see. The windows are drawn from the shapes inside it. */
  surfaces?: string[];
  /** coach: what can be used inside those windows. Everything else in them waits. Defaults to the surfaces. */
  live?: string[];
  /** The surface that owns the screen, when it is not the page: the guide is drawn inside it. */
  container?: string;
  side?: Side;
  /** The card sits beside its target where there is room (right, then left), and above it where there is not. */
  beside?: boolean;
  /** Surfaces that join the live windows while they are open, such as the popover a control opens. */
  optional?: string[];
  title?: string;
  body?: string;
  /** The card's one button. */
  action?: GuideAction;
  /** What the step still asks for, ticked as it comes in; an open row takes the picker to it. */
  checklist?: GuideCheck[];
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
    body: 'Scenri needs an image engine to make shots. Setting one up takes about a minute.',
  },
  add: {
    title: 'Add your ingredients',
    body: 'A shot needs a product, a presenter and a scene. Open the ingredients to add one of each.',
  },
  needProduct: {
    title: 'Add a product',
    body: "A product is what you're selling. Its real photos keep it exact in every shot.",
  },
  needPresenter: {
    title: 'Add a presenter',
    body: 'A presenter is who shows it. The same face appears in every shot.',
  },
  needScene: {
    title: 'Add a scene',
    body: 'A scene is where it happens: a place and its light, ready to shoot in again.',
  },
  pickedAll: {
    title: "That's everything a shot needs",
    body: 'Continue to describe the shot.',
  },
  direct: {
    title: 'Describe the shot',
    body: 'A few words about the place, the light or the moment. Your ingredients already carry how things look.',
  },
  shape: {
    title: 'Choose the shape',
    body: 'Square for feeds, tall for stories, wide for banners. Open it and pick one.',
  },
  count: {
    title: 'Choose how many',
    body: 'Each shot is its own take on the same brief. Open it and pick how many to make.',
  },
  quality: {
    title: 'Choose the size',
    body: 'Larger shots take longer to make. Open it and pick one; Standard is right for trying ideas.',
  },
  settings: {
    title: 'Choose shape, number and size',
    body: 'The shape of the frame, how many takes, and how large. Open the settings and set them.',
  },
  generate: {
    title: 'Make it',
    body: 'Scenri puts your ingredients and words together into shots.',
  },
  waiting: {
    title: 'Your shots are on the way',
    body: 'Every shot keeps its ingredients, so you can change one thing later without starting over.',
  },
  failed: {
    title: "That one didn't work",
    body: 'The tile says why. Your ingredients and words are still in the brief, so you can try again.',
  },
  result: {
    title: 'Your first shot is ready',
    body: 'Open it to refine: say what to change, and everything else stays.',
  },
  refineAsk: {
    title: 'Change one thing',
    body: 'Like warmer light or a closer crop. Everything else in the shot stays.',
  },
  refineResult: {
    title: 'A new version',
    body: 'The original is one step back, so nothing is lost.',
  },
  product: {
    title: 'Add your product',
    body: 'A few real photos keep it exact in every shot. You can also import your store below.',
  },
  presenterIntro: {
    title: 'Create a presenter',
    body: 'A presenter is a person you create once and reuse, so the same face appears in every shot. Describe someone, or start from photos.',
  },
  presenterLook: {
    title: 'Build their look',
    body: 'A few quick questions about how they look. Pick an answer, or type your own.',
  },
  presenterDescribe: {
    title: 'Describe them',
    body: 'One or two sentences: who they are, roughly how old, and what stands out. You can change anything later.',
  },
  presenterPhotos: {
    title: 'Start from real photos',
    body: 'The face in these photos becomes their face in every shot. Sharp, front-facing and well lit works best.',
  },
  presenterTraits: {
    title: 'Anything distinctive?',
    body: 'Glasses, freckles, a tattoo: pick what makes them recognisable, or choose Nothing else.',
  },
  presenterDraw: {
    title: 'Draw the presenter',
    body: "Scenri draws the face first, and you'll decide on it before anything else is made.",
  },
  presenterFace: {
    title: 'Decide the face',
    body: 'Every shot with this presenter uses this face. Use it, try again, or say what to change.',
  },
  presenterBody: {
    title: 'Check the full body',
    body: 'This view keeps their build and clothes right in full-length shots. Use it, or try again.',
  },
  presenterExtras: {
    title: 'More angles are optional',
    body: 'Extra views help in action shots. Not now is fine for a first presenter.',
  },
  presenterName: {
    title: 'Name them',
    body: "The name is how you'll find them among your ingredients.",
  },
  presenterSave: {
    title: 'Save your presenter',
    body: 'Once saved, they appear in the ingredients for every shot.',
  },
  scene: {
    title: 'Build a scene',
    body: 'A scene is a place and its light, saved to shoot in again. Photos of a real place work best, or describe it.',
  },
  continue: 'Continue',
} as const;

const tile = (id: string) => `.sc-feed .sc-cell[data-fb-node="${id}"]`;
const finished = (n: GuideTaskNode) => n.status === 'done' && n.images > 0;
const failed = (n: GuideTaskNode) =>
  n.status === 'error' || n.status === 'cancelled' || (n.status === 'done' && n.images === 0);

/** The three ingredients a first shot asks for, in the order they are asked for. */
const KINDS = [
  { id: 'product', label: 'Product', need: 'needProduct' },
  { id: 'presenter', label: 'Presenter', need: 'needPresenter' },
  { id: 'scene', label: 'Scene', need: 'needScene' },
] as const;

/** The picker's tab for each ingredient the checklist asks for. */
export const CHECK_TAB = { product: 'Products', presenter: 'Presenters', scene: 'Scenes' } as const;

/**
 * A product, a presenter and a scene, each ticked when the brief holds one.
 * One the library has none of is never asked for.
 */
export function shotChecklist(c: ComposerFacts): GuideCheck[] {
  const held = { product: c.products > 0, presenter: c.presenters > 0, scene: c.scene };
  return KINDS.filter((k) => c.offered[k.id]).map((k) => ({ id: k.id, label: k.label, done: held[k.id] }));
}

/** "a product", "a product and a scene", "a product, a presenter and a scene". */
const listed = (items: string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** Everything in the brief that is an ingredient rather than words. */
export const ingredientsOf = (c: ComposerFacts) => c.products + c.presenters + (c.scene ? 1 : 0) + c.others;

export interface ShotFacts {
  /** On the brand's Create page, the task's brand, with nothing modal over it. */
  here: boolean;
  composer: ComposerFacts | null;
  /** What the task has sent, newest first. */
  nodes: readonly GuideTaskNode[];
  /** Steps the person has said they are done with (the direction, by Continue or Enter). */
  confirmed?: readonly string[];
}

const BRIEF = '[data-guide="compose"] .sc-brief-line';

/** The first shot, from the outcome back to the first thing to do, one control at a time. */
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
  // The composer stays in view as one window; the card points at the one
  // control the step asks for, and only that control can be used.
  const coach = (id: string, target: string, copy: { title: string; body: string }, live = [target]): Guidance => ({
    id,
    voice: 'coach',
    target,
    surfaces: [COMPOSE],
    live,
    side: 'top',
    ...copy,
  });
  if (c.engine !== 'ready')
    return { ...coach('engine', '[data-guide="compose.engine"]', COPY.engine), optional: ['.sc-note-pop'] };
  // A product, a presenter and a scene, one of each, before the shot is described.
  const checklist = shotChecklist(c);
  const missing = checklist.filter((k) => !k.done);
  // the words are about the next one still missing
  const need = missing.length ? COPY[KINDS.find((k) => k.id === missing[0].id)?.need ?? 'needProduct'] : null;
  const still = listed(missing.map((k) => `a ${k.label.toLowerCase()}`));
  if (c.pickerOpen) {
    // the picker to browse and pick from, and its own toggle to close it
    const inPicker = { target: PICKER, live: [PICKER, '[data-guide="compose.add"]'], beside: true, checklist };
    if (need)
      return {
        ...coach('pick', PICKER, { title: `Add ${still}`, body: need.body }),
        ...inPicker,
        action: { kind: 'close-picker', label: COPY.continue, disabled: true },
      };
    return {
      ...coach('picked-all', PICKER, COPY.pickedAll),
      ...inPicker,
      action: { kind: 'close-picker', label: COPY.continue },
    };
  }
  if (need) {
    const copy = missing.length === checklist.length ? COPY.add : { title: `Now add ${still}`, body: need.body };
    return { ...coach('add', '[data-guide="compose.add"]', copy), checklist };
  }
  // The direction is done when the person says so: typing a first word is not finishing a sentence.
  if (!c.words || !f.confirmed?.includes('direct'))
    return {
      ...coach('direct', BRIEF, COPY.direct),
      ...(c.words ? { action: { kind: 'confirm', label: COPY.continue } } : {}),
    };
  // Each setting is its own step: open it, answer it (keeping it counts), move on.
  const setting = (id: 'shape' | 'count' | 'quality' | 'settings', target: string, pop: string[]): Guidance => ({
    ...coach(id, target, COPY[id]),
    optional: pop,
  });
  const st = c.settled;
  if (c.settings === 'pills') {
    if (!st.shape) return setting('shape', '[data-guide="compose.shape"]', ['.sc-setpop']);
    if (!st.count) return setting('count', '[data-guide="compose.count"]', ['.sc-setpop']);
    if (!st.quality) return setting('quality', '[data-guide="compose.quality"]', ['.sc-setpop']);
  } else if (!(st.shape && st.count && st.quality)) {
    return setting('settings', '[data-guide="compose.settings"]', ['.sc-morepop', '.sc-shotsheet']);
  }
  return coach('generate', '[data-guide="compose.send"]', COPY.generate);
}

/** The steps Back can show again: the ones that point at a control, never a surface that opened or a result. */
export const REVIEWABLE: readonly string[] = [
  'engine',
  'add',
  'direct',
  'shape',
  'count',
  'quality',
  'settings',
  'generate',
];

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
 * A presenter: the studio's conversation, guided at every decision that shapes
 * how the person comes out. The card points at the question's own answers (or
 * at the composer, where the answer is typed); the question and what answers it
 * are the only things that can be used. Steps the studio explains on its own
 * (each look question after the first, the waits while it draws) stay quiet.
 */
export function presenterStep(studio: StudioFacts | null): Guidance | null {
  if (!studio) return null;
  const turn = `.sc-pstudio [data-turn="q:${studio.open}"]`;
  const composer = '.sc-pstudio-foot .sc-convo-card';
  const base = { voice: 'coach' as const, container: '.sc-pstudio', beside: true };
  // a question answered by its own choices
  const choose = (id: string, copy: { title: string; body: string }, more: string[] = []): Guidance => ({
    ...base,
    id,
    target: `${turn} .sc-convo-q`,
    surfaces: [turn, ...more],
    // the portrait beside a decision stays usable: its versions and compare are part of deciding
    live: [turn, ...more],
    ...copy,
  });
  // a question answered in words, in the composer under the conversation
  const write = (id: string, copy: { title: string; body: string }): Guidance => ({
    ...base,
    id,
    target: composer,
    surfaces: [turn, composer],
    live: [composer],
    ...copy,
  });
  switch (studio.open) {
    case 'source':
      return choose('intro', COPY.presenterIntro);
    case 'look-who':
      return choose('look', COPY.presenterLook);
    case 'describe':
      return write('describe', COPY.presenterDescribe);
    case 'photos':
      return choose('photos', COPY.presenterPhotos);
    case 'traits':
      return choose('traits', COPY.presenterTraits);
    case 'agree':
      return choose('draw', COPY.presenterDraw);
    case 'identity':
    case 'revision':
      return choose('face', COPY.presenterFace, ['.sc-pstudio-well']);
    case 'view-revision':
      return choose('body', COPY.presenterBody, ['.sc-pstudio-well']);
    case 'extras':
      return choose('extras', COPY.presenterExtras);
    case 'name':
      return write('name', COPY.presenterName);
    case 'save':
    case 'blind':
      return choose('save', COPY.presenterSave);
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
  /** The step as the next thing to do. */
  title: string;
  /** One sentence on what it gives, or what it waits for. */
  why: string;
  /** Its name in the row of every step. */
  label: string;
  state: 'todo' | 'active' | 'done';
}

const ROWS: { task: GuideTaskId; title: string; why: string; label: string; resume: string }[] = [
  {
    task: 'first-shot',
    title: 'Make your first shot',
    why: 'Pick an ingredient, describe the shot, and Scenri makes it.',
    label: 'First shot',
    resume: 'Continue your first shot',
  },
  {
    task: 'refine',
    title: 'Refine a shot',
    why: 'Change one thing about a shot and keep everything else.',
    label: 'Refine',
    resume: 'Continue refining',
  },
  {
    task: 'product',
    title: 'Add your own product',
    why: 'A few photos keep it exact in every shot you make.',
    label: 'Product',
    resume: 'Continue adding your product',
  },
  {
    task: 'presenter',
    title: 'Create a presenter',
    why: 'Create a person once and use the same face in every shot.',
    label: 'Presenter',
    resume: 'Continue your presenter',
  },
  {
    task: 'scene',
    title: 'Build a scene',
    why: 'Save a place and its light to shoot in again.',
    label: 'Scene',
    resume: 'Continue your scene',
  },
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
      why: r.task === 'refine' && state === 'todo' && !view.done.shot ? 'Starts from your first shot.' : r.why,
      label: r.label,
      state,
    };
  });
  // Done with everything, it leaves; asked for from Help, it stays so any step can be done again.
  return rows.every((r) => r.state === 'done') && !view.asked ? null : rows;
}

/** The one step to offer first: the one in hand, else the first not done. Null when every step is done. */
export function nextStep(rows: readonly StepRow[]): StepRow | null {
  return rows.find((r) => r.state === 'active') ?? rows.find((r) => r.state === 'todo') ?? null;
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
