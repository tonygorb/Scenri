import type { GuideTaskId, GuideTaskNode, GuideView } from './apiTypes.js';

/**
 * The lessons (DESIGN.md, "First use"): each one is a real thing to do in
 * Scenri, run by the same guided task the tutor already follows. This is the
 * one list of them, and Learn shows it, reading whether each one is done, in
 * hand or new from the install record. Nothing here stores anything: a lesson
 * is a task, a few words about it, and a picture of what it makes.
 *
 * A new lesson is a new guided task first (its rule in guidedTasks.ts, where
 * it begins in useLaunchTask.ts), and then an entry here.
 */
export interface Lesson {
  /** The guided task it runs. */
  id: GuideTaskId;
  title: string;
  /** One sentence: what someone has at the end of it. */
  summary: string;
  /** What it walks through, as outcomes rather than clicks. */
  steps: readonly string[];
  /**
   * What it needs before it can begin: a shot to refine, or a product of
   * their own to use again. Neither is a lock, and both offer the lesson
   * that makes the missing thing.
   */
  needs?: 'shot' | 'product';
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'first-shot',
    title: 'Make your first shot',
    summary:
      'A shot is three things Scenri keeps for you, put together and directed: what you sell, who shows it, and where it happens. Start with ours to see the shape of it, then swap in your own.',
    steps: [
      'Open Create',
      'Choose a product',
      'Choose a presenter',
      'Choose a scene',
      'Say how to shoot it, then make it',
      'Open your shot',
    ],
  },
  {
    id: 'product',
    title: 'Add your product',
    summary:
      'Your own product, added once from its packshots or straight from your store, and exact in every shot you make from then on. Nothing is drawn here and nothing is spent.',
    steps: ['Add its photos, or bring in your store'],
  },
  {
    id: 'reuse',
    title: 'Use it again',
    summary:
      'The same saved product in a different world. This is the whole point of keeping ingredients: one thing you added once, shot again and again without describing it twice.',
    steps: [
      'Open Create',
      'Add the product you saved',
      'Put it somewhere else',
      'Say how to shoot it, then make it',
      'See the same product in both',
    ],
    needs: 'product',
  },
  {
    id: 'presenter',
    title: 'Create a presenter',
    summary:
      'One person Scenri keeps, invented question by question or built from photos of someone real, who stays the same face across every shot you put them in.',
    steps: ['Describe someone, or add photos', 'Decide the face', 'Save them to the brand'],
  },
  {
    id: 'scene',
    title: 'Build a scene',
    summary:
      'A place and its light, saved once and shot in again. References are evidence rather than backdrops: a scene reaches a shot as words, so nothing in them is copied into a picture.',
    steps: ['Name it, then add a photo or a line of direction'],
  },
  {
    id: 'refine',
    title: 'Refine a shot',
    summary:
      'Change one thing about a shot you already have and keep everything else, including the original. This is how a shot gets good: one change at a time, never a fresh start.',
    steps: ['Choose a shot to change', 'Say the one thing to change', 'See the change on the trail'],
    needs: 'shot',
  },
];

/** What a lesson still missing what it starts from says, and does about it. */
export const NEEDS: Record<'shot' | 'product', { note: string; action: string; status: string }> = {
  shot: {
    note: 'Refining starts from a shot you have made.',
    action: 'Make a shot first',
    status: 'Needs a shot',
  },
  product: {
    note: 'Using one again starts with a product of your own.',
    action: 'Add a product first',
    status: 'Needs a product',
  },
};

export function lessonOf(id: string | null | undefined): Lesson | null {
  return LESSONS.find((l) => l.id === id) ?? null;
}

export type LessonState = 'new' | 'active' | 'done';

/**
 * Part done in this brand, done, or not begun.
 *
 * Part done wins over done: a lesson taken again is being done again. It is
 * read from the lesson's own progress rather than from whichever lesson is
 * guiding, which is the whole point: several can be part done at once, and
 * taking up another one costs the rest nothing. A lesson set down still says
 * how far it got, and its action still says Continue.
 *
 * Standing on the first step is not part done, which is why `at` is asked
 * for: how far the lesson has got right now, counted the way its own card
 * counts it (`stepOf`, and the milestones behind it). Taking a lesson up and
 * leaving it on its first step has produced nothing, so it says Start and how
 * many steps it has, the way it did before it was opened. Its window is kept
 * all the same: this is what the row says, not what the record holds.
 *
 * Done means this lesson was walked to its end, and nothing else. The
 * install's `done` milestones say what the library proves about the product
 * (which is what stops the tutor teaching what someone clearly knows), and
 * that is a different question: owning a product is not having taken the
 * lesson about products.
 */
export function lessonState(
  id: GuideTaskId,
  view: Pick<GuideView, 'lessons' | 'progress'>,
  brandId: string,
  at: number,
): LessonState {
  if (view.progress?.[id]?.brandId === brandId && at > 0) return 'active';
  return view.lessons?.[id] ? 'done' : 'new';
}

export interface ProgressFacts {
  /** The moment the tutor would show for this task were nothing over it, when that can be said. */
  moment: string | null;
  /** What the task has sent, newest first. */
  nodes: readonly GuideTaskNode[];
  /** The presenter task has a draft of its own. */
  draft: boolean;
}

/**
 * Which step of its lesson each moment of a task is. This is the one place
 * the tutor and Learn meet: the card counts these steps, Learn ticks these
 * steps, and a lesson's list is exactly what its walk does. A moment missing
 * from here is one that carries no count, which is only ever the greeting.
 *
 * A step exists because the tutor can say it. What pressing Start does (open
 * the dialog, open the shot, open the studio) is not a step: listing it made
 * every one of those walks open on "2 of 3", which reads as having missed
 * something. Nor is the engine ask: nothing can draw yet, which is a thing to
 * fix before the lesson means anything, and counting it said someone with no
 * engine was two steps into making a shot.
 */
const AT: Record<GuideTaskId, Record<string, number>> = {
  'first-shot': {
    go: 0,
    product: 1,
    presenter: 2,
    scene: 3,
    make: 4,
    sending: 4,
    waiting: 4,
    failed: 4,
    result: 5,
  },
  product: { product: 0 },
  reuse: { go: 0, product: 1, scene: 2, make: 3, sending: 3, waiting: 3, failed: 3, again: 4 },
  presenter: { start: 0, face: 1, save: 2 },
  scene: { scene: 0 },
  refine: { choose: 0, ask: 1, 'refine-failed': 1, refining: 2, refined: 2 },
};

/**
 * Where a moment sits in its lesson, and how many steps that lesson has, so
 * the tutor's card says the same thing Learn does (`GuideHost`). The greeting
 * has no step of its own and so no count.
 */
/** The furthest step a lesson has reached, from the milestones it has seen. */
export function furthest(id: GuideTaskId, reached: readonly string[]): number {
  let at = 0;
  for (const moment of reached) {
    const step = AT[id][moment];
    if (step !== undefined && step > at) at = step;
  }
  return at;
}

export function stepOfMoment(id: GuideTaskId, moment: string): { at: number; of: number } | null {
  const at = AT[id][moment];
  const of = LESSONS.find((l) => l.id === id)?.steps.length ?? 0;
  return at === undefined || !of ? null : { at: at + 1, of };
}

const finished = (n: GuideTaskNode) => n.status === 'done' && n.images > 0;

/**
 * The step a lesson in hand is on, from what is true now: the tutor's own
 * moment when it has one, and otherwise only what the record proves (a shot
 * was sent, a draft exists, a build is running). Never further than that: a
 * step shows as done because the product says it happened.
 */
export function stepOf(id: GuideTaskId, f: ProgressFacts): number {
  const at = f.moment ? AT[id][f.moment] : undefined;
  if (at !== undefined) return at;
  switch (id) {
    case 'first-shot':
      return f.nodes.some(finished) ? 5 : f.nodes.length > 0 ? 4 : 0;
    case 'reuse':
      return f.nodes.some(finished) ? 4 : f.nodes.length > 0 ? 3 : 0;
    case 'presenter':
      return f.draft ? 1 : 0;
    case 'refine':
      return f.nodes.some(finished) || f.nodes.some((n) => n.status === 'running') ? 2 : 0;
    default:
      return 0;
  }
}

/**
 * Each lesson's own two pictures, made for Learn as one story: the product,
 * the presenter and the place, then the first shot made from all three, then
 * that shot refined. A square for its row in the list and a wide one for the
 * lesson itself, each framed for its shape rather than cropped from the other.
 */
export const LESSON_PICTURES: Record<GuideTaskId, { square: string; wide: string }> = {
  'first-shot': {
    square: new URL('./assets/lessons/first-shot-square.webp', import.meta.url).href,
    wide: new URL('./assets/lessons/first-shot-wide.webp', import.meta.url).href,
  },
  product: {
    square: new URL('./assets/lessons/product-square.webp', import.meta.url).href,
    wide: new URL('./assets/lessons/product-wide.webp', import.meta.url).href,
  },
  reuse: {
    square: new URL('./assets/lessons/reuse-square.webp', import.meta.url).href,
    wide: new URL('./assets/lessons/reuse-wide.webp', import.meta.url).href,
  },
  presenter: {
    square: new URL('./assets/lessons/presenter-square.webp', import.meta.url).href,
    wide: new URL('./assets/lessons/presenter-wide.webp', import.meta.url).href,
  },
  scene: {
    square: new URL('./assets/lessons/scene-square.webp', import.meta.url).href,
    wide: new URL('./assets/lessons/scene-wide.webp', import.meta.url).href,
  },
  refine: {
    square: new URL('./assets/lessons/refine-square.webp', import.meta.url).href,
    wide: new URL('./assets/lessons/refine-wide.webp', import.meta.url).href,
  },
};
