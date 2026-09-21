import type { GuideTaskId, GuideTaskNode, GuideView, ShowcaseEntry } from './apiTypes.js';
import type { ComposerFacts, StudioFacts } from './guideFacts.js';

/**
 * First use, as rules (DESIGN.md, "First use").
 *
 * A guided task helps someone do one real thing: make a first shot, refine it,
 * create a presenter, build a scene. A tutor stands beside them and says one
 * thing at a time.
 *
 * The whole mechanism is a pure function per task: facts in, one moment out.
 * A moment is the first rule that is true, checked from the outcome back, so a
 * send that empties the brief never sends the tutor back to the start, and
 * resuming is simply asking again. Nothing counts steps, nothing stores an
 * index, and nothing advances because a control was clicked: a moment is over
 * when the product says so (a chip is in the brief, words exist, a picture
 * finished, the brand holds one more presenter).
 */

export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface Moment {
  /** Stable, for Back and for the tests. */
  id: string;
  /**
   * `ask` holds the page: a curtain with the asked control lit, and only that
   * control usable. `note` points at something that just happened and holds
   * nothing. `quiet` draws nothing at all: the task is still in hand, and the
   * surface is already saying what to do.
   */
  voice: 'ask' | 'note' | 'quiet';
  title?: string;
  body?: string;
  /** What the card points at, as a selector. */
  point?: string;
  /** What can be used. Defaults to the thing being pointed at. */
  live?: string[];
  /**
   * Usable too, when they are on screen, but not what is asked for and never
   * waited for: the portrait beside the question about it, which a phone
   * does not draw; the studio's own line, where a typed sentence answers.
   */
  also?: string[];
  /**
   * Surfaces that stay lit but are not for using: the composer under its own
   * open picker, which would otherwise go dark beneath the panel it opened.
   */
  lit?: string[];
  /** The surface that owns the screen, when it is not the page: the tutor is drawn inside it. */
  shell?: string;
  /** The card sits beside a big surface rather than above it. */
  beside?: boolean;
  /** Which side to try first. */
  side?: Side;
  /** Where this is in the walk, when the walk has a length: "2 of 5". */
  at?: number;
  of?: number;
  /** The task is done: the card offers Done, and its X means the same. */
  done?: boolean;
  /**
   * There is nothing to do here yet: this one explains, and the card carries
   * the one button that moves past it. The only moment that ever does.
   */
  start?: boolean;
  /**
   * The page stays in view: dimmed, never blurred. For a moment that is a way
   * somewhere rather than a thing to do here, where seeing the page you are on
   * is the point.
   */
  soft?: boolean;
}

const LIBRARY_NEW = '[data-guide="library.new"]';

/** The way to a place, on the page they are on: they walk it, nothing jumps. */
export const wayTo = (nav: string, say: { title: string; body: string }): Moment => ({
  id: 'go',
  voice: 'ask',
  point: `[data-guide="nav.${nav}"]`,
  side: 'bottom',
  soft: true,
  ...say,
});
const COMPOSE_PICKER = '[data-guide="compose"] .sc-attachpanel';
/** Inside the picker, the one thing an ask is about: the shelf of things to choose from. */
const PICKER_GRID = '[data-guide="compose"] .sc-attachpanel .sc-ap-body';
/**
 * The composer's own card, which the picker opens out of and sits on top of.
 * Refining reuses this: it is the same card, armed at a shot from its own
 * tile rather than opened fresh.
 */
export const COMPOSE_CARD = '[data-guide="compose"] .sc-promptcard';
const ADD = '[data-guide="compose.add"]';
const BRIEF = '[data-guide="compose"] .sc-brief-line';
const SEND = '[data-guide="compose.send"]';
const ENGINE = '[data-guide="compose.engine"]';
const STUDIO = '.sc-pstudio';
/** The studio's own answer line: a typed sentence answers the question above it. */
const STUDIO_COMPOSER = `${STUDIO} .sc-convo-card`;
const DIALOG = '.sc-newdlg-layer';
const SHOT = '.sc-ovl';

/** Every word the tutor says, in one place, so the copy rules can hold them all. */
export const COPY = {
  go: {
    title: 'Shots are made in Create',
    body: "A shot is built from what you sell, who shows it and where. Open Create, and we'll make your first one together.",
  },
  intro: {
    title: 'This is Create, where shots are made',
    body: 'A shot is built from three things Scenri keeps for you: what you sell, who shows it, and where it happens. Add them, say how to shoot it, and Scenri makes the picture in about a minute.',
  },
  engine: {
    title: 'Connect image generation',
    body: 'Scenri needs an image engine before it can make anything. Setting one up takes about a minute.',
  },
  product: {
    title: 'Choose a product',
    body: 'A product is the thing you are selling. Scenri keeps its real photos, so it looks the same in every shot you make.',
  },
  presenter: {
    title: 'Choose a presenter',
    body: 'A presenter is a person Scenri keeps. Pick one and the same face shows your product in every shot.',
  },
  scene: {
    title: 'Choose a scene',
    body: 'A scene is a place and its light. It decides where the shot happens and how it feels.',
  },
  make: {
    title: 'Say how to shoot it, then make it',
    body: 'A few words about the moment, the light or the framing. Generate then puts your ingredients and your words together into a picture.',
  },
  waiting: {
    title: 'Scenri is making it',
    body: 'This takes a moment. Your ingredients are kept, so you can change one thing later without starting over.',
  },
  result: {
    title: 'Your first shot',
    body: 'The product, the presenter and the scene you chose are kept, so your next shot starts from them. Open it to change one thing.',
  },
  failed: {
    title: "That one didn't work",
    body: 'The tile says why. Put the shot together again and Scenri will try it again.',
  },
  reuseProduct: {
    title: 'Add the product you saved',
    body: 'Yours sits in the shelf with ours. Putting it in again costs nothing: it is the same product, in a new shot.',
  },
  reuseScene: {
    title: 'Put it somewhere else',
    body: 'A different place and light, so the two shots share the product and little else.',
  },
  reuseResult: {
    title: 'The same product, twice',
    body: 'Two shots, one thing you added once. Anything Scenri keeps works this way: products, presenters and scenes.',
  },
  refineAsk: {
    title: 'Change one thing',
    body: 'Say what to change, like warmer light or a closer crop. The rest of the shot stays.',
  },
  refineResult: {
    title: 'Here is the change',
    body: 'The original stays one step back in the history, so nothing is lost.',
  },
  refineFailed: {
    title: "That change didn't work",
    body: 'Say the change again and Scenri will try it once more.',
  },
  refineChoose: {
    title: 'Choose a shot to change',
    body: 'Open one from what you have made. You can also use Refine on its card.',
  },
  refineGo: {
    title: 'Your shots live in Create',
    body: 'Refining starts from a picture you already have. Open Create to find one.',
  },
  productGo: {
    title: 'Your products live here',
    body: 'Each one you add is kept, so it looks the same in every shot. Open Products to add yours.',
  },
  productNew: {
    title: 'Start a new product',
    body: 'Add its real photos, or bring in your catalog from your store. Either way it is yours to reuse.',
  },
  sceneGo: {
    title: 'Your scenes live here',
    body: 'A scene is a place and its light, saved to shoot in again. Open Scenes to make one.',
  },
  sceneNew: {
    title: 'Start a new scene',
    body: 'Name it, then add a photo of the place or a line of direction.',
  },
  presenterGo: {
    title: 'Your presenters live here',
    body: 'A presenter is a person Scenri keeps, the same face in every shot. Open Presenters to make one.',
  },
  presenterNew: {
    title: 'Start a new presenter',
    body: 'Describe someone, or add photos of a real person. The studio takes it from there.',
  },
  presenterEngine: {
    title: 'Set up image generation',
    body: 'Drawing a face needs an engine. Setting one up takes about a minute, and the answers so far are kept.',
  },
  presenterStart: {
    title: 'Describe someone, or start from photos',
    body: 'Photos keep a real face. Describing invents one, question by question.',
  },
  presenterFace: {
    title: 'Decide the face',
    body: 'Every shot with this presenter uses this face, so take the one you want.',
  },
  presenterSave: {
    title: 'Save your presenter',
    body: 'Once saved they are in your ingredients, ready for every shot.',
  },
  sceneMake: {
    title: 'Build a scene',
    body: 'A place and its light, saved to shoot in again. Name it, then add a photo or a line of direction.',
  },
  productMake: {
    title: 'Add your product',
    body: 'Its real photos keep it the same in every shot. Add a few, or bring in your catalog from your store.',
  },
} as const;

const tile = (id: string) => `.sc-feed .sc-cell[data-fb-node="${id}"]`;
const finished = (n: GuideTaskNode) => n.status === 'done' && n.images > 0;
const failed = (n: GuideTaskNode) =>
  n.status === 'error' || n.status === 'cancelled' || (n.status === 'done' && n.images === 0);

/** Everything in the brief that is an ingredient rather than words. */
export const ingredientsOf = (c: ComposerFacts) => c.products + c.presenters + (c.scene ? 1 : 0) + c.others;

/** The ingredients the first shot asks for, in order, and the picker tab each lives on. */
export const ASK_TAB = { product: 'Products', presenter: 'Presenters', scene: 'Scenes' } as const;
export type AskedKind = keyof typeof ASK_TAB;

export interface ShotFacts {
  /** On the brand's Create page, the task's brand, with nothing modal over it. */
  here: boolean;
  composer: ComposerFacts | null;
  /** What the task has sent, newest first. */
  nodes: readonly GuideTaskNode[];
  /** The opening has been read. */
  begun?: boolean;
  /**
   * Just begun somewhere else (the welcome, Learn) and not yet on Create. The
   * first step is getting there, done by them rather than done to them.
   */
  heading?: boolean;
  /**
   * This walk began with that way there, so its step is the first of the walk
   * and it said what the opening would have: the count runs to five, not four.
   */
  viaBar?: boolean;
}

/**
 * The first shot: one ask at a time, from the outcome back.
 *
 * What it teaches is the shape of a brief, in the order the brief reads: a
 * product (what), a presenter (who), a scene (where), then the words (how).
 * None of the three are needed to generate; they are the lesson, and each is
 * one click. The settings are never asked about: they are optional, they
 * explain themselves, and they stay usable while the last ask is on screen.
 */
export function firstShotMoment(f: ShotFacts): Moment | null {
  // Begun from another page, the first step is the way there: Create in the
  // places, lit, with the page left in plain view. Arriving by their own hand
  // is what tells them where Create is and how they got there.
  if (!f.here) return f.heading ? wayTo('create', COPY.go) : null;
  const c = f.composer;
  const made = f.nodes.find(finished);
  if (made) return { id: 'result', voice: 'note', point: tile(made.id), side: 'bottom', ...COPY.result, done: true };
  const running = f.nodes.find((n) => n.status === 'running');
  if (running) return { id: 'waiting', voice: 'note', point: tile(running.id), side: 'bottom', ...COPY.waiting };
  // A send that has left but whose shots have not landed: nothing to point at yet.
  if (c?.busy) return { id: 'sending', voice: 'quiet' };
  if (!c || c.refining) return null;
  const building = c.pickerOpen || ingredientsOf(c) > 0 || c.words;
  const dud = f.nodes.find(failed);
  if (dud && !building) return { id: 'failed', voice: 'note', point: tile(dud.id), side: 'bottom', ...COPY.failed };
  // Nothing can draw: that is the one thing to fix before any of this matters.
  if (c.engine !== 'ready') return { id: 'engine', voice: 'ask', point: ENGINE, side: 'top', ...COPY.engine };
  /**
   * Four asks. Four is the ceiling on purpose: completion holds around 72 to
   * 74% at three or four steps and falls below half at five (Chameleon, 550M
   * in-app interactions). What the card says about where it is comes from the
   * lesson's own list (lessons.ts), so the tutor and Learn cannot disagree;
   * the greeting has no step of its own and so no count.
   */
  // The opening greets an empty start only: someone coming back to a brief
  // they have already begun is past being told what this place is.
  // Nothing is pointed at yet: arriving somewhere new, the first thing to
  // settle is where they are, said in the middle of the page they landed on.
  if (!f.begun && ingredientsOf(c) === 0 && !c.words)
    return { id: 'intro', voice: 'ask', live: [], start: true, ...COPY.intro };
  const asked = askedKind(c);
  if (asked) return pickMoment(asked, c.pickerOpen);
  // The last one is both halves of the same act: write the line, then make it.
  return { id: 'make', voice: 'ask', point: SEND, live: [BRIEF, SEND], side: 'top', ...COPY.make };
}

/**
 * Using a saved thing again: the second shot, and the first time reuse is
 * visible rather than described. It asks for the product they added, then a
 * different place for it, then the words, and ends on the two pictures
 * standing beside each other. Three asks, because what it teaches is the
 * comparison, not how to compose.
 */
export function reuseMoment(f: ShotFacts): Moment | null {
  if (!f.here) return f.heading ? wayTo('create', COPY.go) : null;
  const c = f.composer;
  const made = f.nodes.find(finished);
  if (made)
    return { id: 'again', voice: 'note', point: tile(made.id), side: 'bottom', ...COPY.reuseResult, done: true };
  const running = f.nodes.find((n) => n.status === 'running');
  if (running) return { id: 'waiting', voice: 'note', point: tile(running.id), side: 'bottom', ...COPY.waiting };
  if (c?.busy) return { id: 'sending', voice: 'quiet' };
  if (!c || c.refining) return null;
  const building = c.pickerOpen || ingredientsOf(c) > 0 || c.words;
  const dud = f.nodes.find(failed);
  if (dud && !building) return { id: 'failed', voice: 'note', point: tile(dud.id), side: 'bottom', ...COPY.failed };
  if (c.engine !== 'ready') return { id: 'engine', voice: 'ask', point: ENGINE, side: 'top', ...COPY.engine };
  if (c.products === 0) return pickMoment('product', c.pickerOpen, COPY.reuseProduct);
  if (!c.scene) return pickMoment('scene', c.pickerOpen, COPY.reuseScene);
  return { id: 'make', voice: 'ask', point: SEND, live: [BRIEF, SEND], side: 'top', ...COPY.make };
}

/** The ingredient the first shot is still asking for, or null once the brief holds all three. */
export function askedKind(c: ComposerFacts): AskedKind | null {
  if (c.products === 0) return 'product';
  if (c.presenters === 0) return 'presenter';
  if (!c.scene) return 'scene';
  return null;
}

/**
 * One ingredient, asked for where it is added. The picker is the same moment
 * with the same words: while it is open it is what the card points at, and the
 * only thing that can be used is the shelf of things to choose from. Not the
 * search, not Upload, not the tabs (there are none while it asks), and not the
 * shelf's own way to make a new one, which the picker leaves out while it asks:
 * there is one action here, and it is choosing one of them. The brief's own
 * `$ @ / #` are words while the walk is on (BriefInput): every chip comes in
 * through the ask for it and leaves through Back.
 */
function pickMoment(kind: AskedKind, pickerOpen: boolean, words?: { title: string; body: string }): Moment {
  const say = words ?? COPY[kind];
  return pickerOpen
    ? {
        id: kind,
        voice: 'ask',
        point: COMPOSE_PICKER,
        live: [PICKER_GRID],
        lit: [COMPOSE_CARD],
        beside: true,
        side: 'right',
        ...say,
      }
    : { id: kind, voice: 'ask', point: ADD, side: 'top', ...say };
}

export interface RefineFacts {
  /** The refine surface at all: the grid, or a shot's own overlay, in the task's brand. */
  here: boolean;
  /** Specifically, a shot's own overlay is open. */
  open: boolean;
  /** Not open, but the dock composer on the grid is armed with a shot to refine. */
  armed: boolean;
  nodes: readonly GuideTaskNode[];
  /** The composer that would ask offers itself right now: a failed step does not, until they step back to one that does. */
  asking?: boolean;
  /**
   * Just begun somewhere else (Learn) and not yet on Create. The first step
   * is getting there, done by them rather than done to them.
   */
  heading?: boolean;
}

/** The open shot's composer, where a change is asked for. */
export const SHOT_COMPOSER = `${SHOT} .sc-promptcard`;
/** The open shot's picture, which the change is about. */
const SHOT_PICTURE = `${SHOT} .sc-stage-img`;
/** The open shot's history: the original, then each refinement. */
const SHOT_HISTORY = `${SHOT} .sc-trail`;
/** Where shots live: the one place to find one, whichever way it is then chosen. */
const FEED = '.sc-feed';

/**
 * Refining: choose a shot, ask for one change, wait, then point at where it
 * landed. There are two real ways to choose one — opening it, or the card's
 * own Refine — and both land on the same ask, because both are the user's
 * own click rather than one this task makes for them. The picture stays in
 * sight while the change is asked for, because saying what to change means
 * looking at it.
 */
export function refineMoment(f: RefineFacts): Moment | null {
  if (f.heading) return wayTo('create', COPY.refineGo);
  if (!f.here) return null;
  if (!f.open && !f.armed)
    return { id: 'choose', voice: 'ask', point: FEED, live: [FEED], beside: true, side: 'left', ...COPY.refineChoose };
  const made = f.nodes.find(finished);
  if (made)
    return f.open
      ? {
          id: 'refined',
          voice: 'note',
          shell: SHOT,
          point: SHOT_HISTORY,
          side: 'top',
          ...COPY.refineResult,
          done: true,
        }
      : { id: 'refined', voice: 'note', point: tile(made.id), side: 'bottom', ...COPY.refineResult, done: true };
  if (f.nodes.some((n) => n.status === 'running')) return { id: 'refining', voice: 'quiet' };
  // A step that failed has no composer of its own: the history, or the tile itself, is where they go next.
  const dud = f.nodes.find(failed);
  if (dud && !f.asking)
    return f.open
      ? { id: 'refine-failed', voice: 'note', shell: SHOT, point: SHOT_HISTORY, side: 'top', ...COPY.refineFailed }
      : { id: 'refine-failed', voice: 'note', point: tile(dud.id), side: 'bottom', ...COPY.refineFailed };
  return f.open
    ? {
        id: 'ask',
        voice: 'ask',
        shell: SHOT,
        point: SHOT_COMPOSER,
        also: [SHOT_PICTURE],
        beside: true,
        side: 'left',
        ...COPY.refineAsk,
      }
    : {
        id: 'ask',
        voice: 'ask',
        point: COMPOSE_CARD,
        live: [COMPOSE_CARD],
        beside: true,
        side: 'top',
        ...COPY.refineAsk,
      };
}

/**
 * The presenter studio speaks for itself: it asks its own questions, one at a
 * time, and a tutor repeating them would be noise. Three moments earn a word,
 * because each is a decision the questions do not explain: which road to take,
 * whether this face is the face, and that saving is what keeps them.
 */
export interface PresenterWalkFacts {
  heading?: boolean;
  /** The presenters library, not the studio over it. */
  onPage?: boolean;
  studio: StudioFacts | null;
}

export function presenterMoment(f: PresenterWalkFacts): Moment | null {
  if (f.heading) return wayTo('presenters', COPY.presenterGo);
  const studio = f.studio;
  if (studio) {
    const turn = `${STUDIO} [data-turn="q:${studio.open}"]`;
    // `also` is what else answers the question: a typed sentence in the studio's
    // own line, the portrait beside it. Neither is waited for: a phone draws no stage.
    const at = (id: string, say: { title: string; body: string }, also: string[] = [], lit?: string[]): Moment => ({
      id,
      voice: 'ask',
      shell: STUDIO,
      // the chips as they sit, not the full-width row they live on and not the
      // line above them. `.sc-convo-ask` shrinks to the buttons.
      point: `${turn} .sc-convo-ask`,
      live: [turn],
      also,
      ...(lit ? { lit } : {}),
      beside: true,
      side: 'left',
      ...say,
    });
    switch (studio.open) {
      case 'source':
        // a sentence typed here is the description, and asks no door
        return at('start', COPY.presenterStart, [STUDIO_COMPOSER]);
      // The studio asks its own questions, but a wall is not a question: nothing
      // in this flow goes on until something can draw, so the tutor says so.
      case 'noengine':
        return at('engine', COPY.presenterEngine);
      case 'identity':
      case 'revision':
        // the portrait stays usable beside the question, and a sentence adjusts
        // it; the face as the conversation shows it (the turn just above the
        // question, all a phone has) stays in sight, and the card stands clear of it
        return at(
          'face',
          COPY.presenterFace,
          ['.sc-pstudio-well', STUDIO_COMPOSER],
          [`${STUDIO} [data-turn]:has(+ [data-turn="q:${studio.open}"])`],
        );
      case 'save':
      case 'blind':
        return at('save', COPY.presenterSave);
      default:
        return { id: 'studio', voice: 'quiet' };
    }
  }
  if (f.onPage) return { id: 'new', voice: 'ask', point: LIBRARY_NEW, side: 'bottom', ...COPY.presenterNew };
  return null;
}

/** One word on the dialog something is made in, then quiet until it exists. */
function dialogMoment(id: string, say: { title: string; body: string }): Moment {
  return { id, voice: 'ask', shell: DIALOG, point: '.sc-newdlg', beside: true, side: 'left', ...say };
}

export interface AssetWalkFacts {
  heading?: boolean;
  onPage?: boolean;
  dialogOpen: boolean;
}

function startOnPage(say: { title: string; body: string }): Moment {
  return { id: 'new', voice: 'ask', point: LIBRARY_NEW, side: 'bottom', ...say };
}

/** A scene: the way there, then start one, then the dialog it is made in. */
export function sceneMoment(f: AssetWalkFacts): Moment | null {
  if (f.heading) return wayTo('scenes', COPY.sceneGo);
  if (f.dialogOpen) return dialogMoment('scene', COPY.sceneMake);
  return f.onPage ? startOnPage(COPY.sceneNew) : null;
}

/** A product: the way there, then start one, then where its photos come from. */
export function productMoment(f: AssetWalkFacts): Moment | null {
  if (f.heading) return wayTo('products', COPY.productGo);
  if (f.dialogOpen) return dialogMoment('product', COPY.productMake);
  return f.onPage ? startOnPage(COPY.productNew) : null;
}

/**
 * The chip the ask before this one put in. First shot asks product, presenter,
 * scene; reuse asks product then scene. Another task's moment may share a name
 * (the scene task's dialog is also `scene`) and has no chip to take back.
 */
export function chipToTakeBack(task: GuideTaskId, id: string): AskedKind | null {
  if (task === 'first-shot') {
    if (id === 'presenter') return 'product';
    if (id === 'scene') return 'presenter';
    if (id === 'make') return 'scene';
  }
  if (task === 'reuse') {
    if (id === 'scene') return 'product';
    if (id === 'make') return 'scene';
  }
  return null;
}

/**
 * DESIGN.md: every counted step after the first has Back, when something can
 * be undone. The first step of a walk and the notes after a send do not.
 */
export function coachCanBack(task: GuideTaskId | null, id: string, viaWay: boolean): boolean {
  if (!task) return false;
  if (chipToTakeBack(task, id)) return true;
  if (viaWay && (id === 'new' || id === 'choose' || ((task === 'first-shot' || task === 'reuse') && id === 'product')))
    return true;
  if (task === 'presenter' && (id === 'start' || id === 'face' || id === 'save')) return true;
  if ((task === 'product' || task === 'scene') && id === task) return true;
  return task === 'refine' && id === 'ask';
}

/** The tasks that end on their own, when the brand holds one more than it did. */
export function madeOne(
  view: Pick<GuideView, 'active' | 'counts'>,
  now: { products: number; presenters: number; scenes: number },
): boolean {
  const a = view.active;
  if (!a) return false;
  if (a.task === 'presenter') return now.presenters > a.baseline.presenters;
  if (a.task === 'scene') return now.scenes > a.baseline.scenes;
  if (a.task === 'product') return now.products > a.baseline.products;
  return false;
}

export interface ContextStart {
  eligible: boolean;
  hidden: boolean;
  done: GuideView['done'];
  dismissed: readonly GuideTaskId[];
  active: GuideView['active'];
}

/** The install's record of each task having been done at least once. */
export const MILESTONE: Record<GuideTaskId, keyof GuideView['done']> = {
  'first-shot': 'shot',
  // Using a saved thing again makes a shot like any other. It is never begun
  // by reaching a surface, only from Learn, so this only keeps the map whole.
  reuse: 'shot',
  refine: 'refine',
  product: 'product',
  presenter: 'presenter',
  scene: 'scene',
};

/**
 * Whether someone new opening a surface on their own begins its task. Only
 * once (not done, not closed), only while the install still wants guiding. A task left
 * in hand on another surface gives way, so an abandoned dialog never blocks the
 * next thing; the first shot never does. Tasks never chain: the caller only
 * asks when the person has engaged with the surface.
 */
export function startsHere(task: GuideTaskId, s: ContextStart): boolean {
  if (!s.eligible || s.hidden) return false;
  if (s.active && (s.active.task === task || s.active.task === 'first-shot')) return false;
  if (s.done[MILESTONE[task]] || s.dismissed.includes(task)) return false;
  if (task === 'refine' && !s.done.shot) return false;
  return true;
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

/** The welcome's words, here so the copy rules cover them with every moment. */
export const WELCOME = {
  lede: 'Scenri makes product shots for your brand. You choose the product, who shows it and where, and it makes the picture.',
  take: 'Make your first shot',
  notNow: 'Not now',
  /** Help's way back to it, and its row's name. */
  again: 'Welcome to Scenri',
  note: (i: { engineReady: boolean; ownsProducts: boolean }) =>
    !i.engineReady
      ? 'First a short setup for image generation, then your first shot together, a step at a time.'
      : i.ownsProducts
        ? "We'll make your first one together, a step at a time, with one of your products."
        : "We'll make your first one together, a step at a time. You can start with one of our products.",
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
