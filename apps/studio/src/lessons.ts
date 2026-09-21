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
export interface Milestone {
  /** What Learn shows: an outcome, never a click. */
  label: string;
  /** The tutor moments that are this milestone. One list, so the two cannot drift. */
  moments: readonly string[];
}

export interface Lesson {
  /** The guided task it runs. */
  id: GuideTaskId;
  title: string;
  /** One sentence: what someone has at the end of it. */
  summary: string;
  /** What it walks through, as outcomes rather than clicks. */
  milestones: readonly Milestone[];
  /**
   * What it needs before it can begin: a shot to refine, or a product of
   * their own to use again. Neither is a lock, and both offer the lesson
   * that makes the missing thing.
   */
  needs?: 'shot' | 'product';
}

/** The labels Learn shows, derived from the milestones so the two cannot drift. */
export function stepsOf(l: Lesson): readonly string[] {
  return l.milestones.map((m) => m.label);
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'first-shot',
    title: 'Make your first shot',
    summary:
      'A shot is three things Scenri keeps for you, put together and directed: what you sell, who shows it, and where it happens. Start with ours to see the shape of it, then swap in your own.',
    milestones: [
      { label: 'Open Create', moments: ['go'] },
      { label: 'Choose a product', moments: ['product'] },
      { label: 'Choose a presenter', moments: ['presenter'] },
      { label: 'Choose a scene', moments: ['scene'] },
      { label: 'Say how to shoot it, then make it', moments: ['make', 'sending', 'waiting', 'failed'] },
      { label: 'Open your shot', moments: ['result'] },
    ],
  },
  {
    id: 'product',
    title: 'Add your product',
    summary:
      'Your own product, added once from its packshots or straight from your store, and exact in every shot you make from then on. Nothing is drawn here and nothing is spent.',
    milestones: [
      { label: 'Find where your products live', moments: ['go'] },
      { label: 'Start a new one', moments: ['new'] },
      { label: 'Add its photos, or bring in your store', moments: ['product'] },
    ],
  },
  {
    id: 'reuse',
    title: 'Use it again',
    summary:
      'The same saved product in a different world. This is the whole point of keeping ingredients: one thing you added once, shot again and again without describing it twice.',
    milestones: [
      { label: 'Open Create', moments: ['go'] },
      { label: 'Add the product you saved', moments: ['product'] },
      { label: 'Put it somewhere else', moments: ['scene'] },
      { label: 'Say how to shoot it, then make it', moments: ['make', 'sending', 'waiting', 'failed'] },
      { label: 'See the same product in both', moments: ['again'] },
    ],
    needs: 'product',
  },
  {
    id: 'presenter',
    title: 'Create a presenter',
    summary:
      'One person Scenri keeps, invented question by question or built from photos of someone real, who stays the same face across every shot you put them in.',
    milestones: [
      { label: 'Find where your presenters live', moments: ['go'] },
      { label: 'Start a new one', moments: ['new'] },
      { label: 'Describe someone, or add photos', moments: ['start'] },
      { label: 'Decide the face', moments: ['face'] },
      { label: 'Save them to the brand', moments: ['save'] },
    ],
  },
  {
    id: 'scene',
    title: 'Build a scene',
    summary:
      'A place and its light, saved once and shot in again. References are evidence rather than backdrops: a scene reaches a shot as words, so nothing in them is copied into a picture.',
    milestones: [
      { label: 'Find where your scenes live', moments: ['go'] },
      { label: 'Start a new one', moments: ['new'] },
      { label: 'Name it, then add a photo or a line of direction', moments: ['scene'] },
    ],
  },
  {
    id: 'refine',
    title: 'Refine a shot',
    summary:
      'Change one thing about a shot you already have and keep everything else, including the original. This is how a shot gets good: one change at a time, never a fresh start.',
    milestones: [
      { label: 'Find the shots you have made', moments: ['go'] },
      { label: 'Choose a shot to change', moments: ['choose'] },
      { label: 'Say the one thing to change', moments: ['ask', 'refine-failed'] },
      { label: 'See the change on the trail', moments: ['refining', 'refined'] },
    ],
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

/**
 * The lesson that comes next: the first in the list that is not done. A later
 * one already in hand does not jump the queue; several can be part done at
 * once, and Next is which one the list still wants first.
 */
export function nextLesson<T extends { id: string }>(lessons: readonly T[], stateOf: (l: T) => LessonState): T | null {
  return lessons.find((l) => stateOf(l) !== 'done') ?? null;
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
 * Moments the tutor can say that carry no lesson step: the greeting, the
 * engine wall, and a studio question that speaks for itself. Everything else
 * a rule can emit sits in exactly one milestone.
 */
export const UNCOUNTED = ['intro', 'engine', 'studio'] as const;

/**
 * Which step of its lesson each moment of a task is. Derived from the
 * milestones, so Learn and the tutor cannot disagree. A moment missing from
 * here is one that carries no count.
 */
const AT: Record<GuideTaskId, Record<string, number>> = Object.fromEntries(
  LESSONS.map((l) => [
    l.id,
    Object.fromEntries(l.milestones.flatMap((m, i) => m.moments.map((moment) => [moment, i]))),
  ]),
) as Record<GuideTaskId, Record<string, number>>;

/** Every counted moment of a lesson, for the test that the two lists stay one. */
export function countedMoments(id: GuideTaskId): readonly string[] {
  return LESSONS.find((l) => l.id === id)?.milestones.flatMap((m) => m.moments) ?? [];
}

/**
 * The furthest step a lesson has reached, from the milestones it has seen.
 */
export function furthest(id: GuideTaskId, reached: readonly string[]): number {
  let at = 0;
  for (const moment of reached) {
    const step = AT[id][moment];
    if (step !== undefined && step > at) at = step;
  }
  return at;
}

/**
 * Whether this lesson has already walked past finding its place. Seeing the
 * way there is not enough: Continue restores a place they have been, and
 * Start on the first step still lets them walk it.
 */
export function progressedPastWay(id: GuideTaskId, reached: readonly string[]): boolean {
  return furthest(id, reached) > 0;
}

export function stepOfMoment(id: GuideTaskId, moment: string): { at: number; of: number } | null {
  const at = AT[id][moment];
  const of = LESSONS.find((l) => l.id === id)?.milestones.length ?? 0;
  return at === undefined || !of ? null : { at: at + 1, of };
}

const finished = (n: GuideTaskNode) => n.status === 'done' && n.images > 0;

/**
 * The step a lesson in hand is on, from what is true now: the tutor's own
 * moment when it has one, and otherwise only what the record proves (a shot
 * was sent, a draft exists, a build is running). Never further than that: a
 * step shows as done because the product says it happened.
 */
/**
 * How far Learn should say this lesson has got.
 *
 * Live facts (the tutor's moment, the task's own nodes, a draft) are only
 * true of the lesson that is actually on this surface. Pass null for every
 * other lesson: another brief or another task's shots must not walk this one
 * forward. What it has reached is always its own, so emptying the brief
 * asks for the chips again without undoing having chosen them.
 */
export function lessonAt(id: GuideTaskId, reached: readonly string[], live: ProgressFacts | null): number {
  const remembered = furthest(id, reached);
  return live ? Math.max(stepOf(id, live), remembered) : remembered;
}

export function stepOf(id: GuideTaskId, f: ProgressFacts): number {
  const at = f.moment ? AT[id][f.moment] : undefined;
  if (at !== undefined) return at;
  switch (id) {
    case 'first-shot':
      return f.nodes.some(finished) ? 5 : f.nodes.length > 0 ? 4 : 0;
    case 'reuse':
      return f.nodes.some(finished) ? 4 : f.nodes.length > 0 ? 3 : 0;
    case 'presenter':
      return f.draft ? 3 : 0;
    case 'refine':
      return f.nodes.some(finished) || f.nodes.some((n) => n.status === 'running') ? 3 : 0;
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
