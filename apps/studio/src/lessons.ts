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
  steps: readonly LessonStep[];
  /** What it needs before it can begin. Refining needs a shot to refine. */
  needs?: 'shot';
}

/**
 * A step is its outcome and one sentence of why it matters. The sentence is
 * Learn's alone: the tutor never reads it, which is what keeps a lesson able
 * to explain while a coachmark stays down to a few words.
 */
export interface LessonStep {
  title: string;
  note: string;
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'first-shot',
    title: 'Make your first shot',
    summary:
      'A shot is three things Scenri keeps for you, put together and directed. Make one and the shape of the whole product is in front of you.',
    steps: [
      {
        title: 'Choose a product, a presenter and a scene',
        note: 'What you sell, who shows it, and where it happens. Start with ours to see how it works, then add your own.',
      },
      {
        title: 'Say how to shoot it',
        note: 'A line about the light, the framing or the moment. The three things you chose stay exactly as they are.',
      },
      {
        title: 'Make the shot',
        note: 'Generate puts your ingredients and your words together into one picture.',
      },
      {
        title: 'Open it',
        note: 'The shot keeps what it was made from, so the next one starts from the same three things.',
      },
    ],
  },
  {
    id: 'product',
    title: 'Add your product',
    summary:
      'Your own product, added once from its photos or your store, and exact in every shot you make from then on.',
    steps: [
      {
        title: 'Start a product',
        note: 'A product is the thing you are selling. Added once, it goes into any shot, as often as you like.',
      },
      {
        title: 'Add its photos, or bring in your store',
        note: 'Straight, well lit packshots: the first three are the ones a shot uses. A store address brings in the whole catalog instead.',
      },
      {
        title: 'Save it',
        note: 'Nothing is drawn and nothing is spent here. It is yours from then on, in the shelf beside every shot.',
      },
    ],
  },
  {
    id: 'presenter',
    title: 'Create a presenter',
    summary: 'One person Scenri keeps, invented or from photos, who stays the same face across every shot.',
    steps: [
      {
        title: 'Start a presenter',
        note: 'A presenter is a person, not a style. The same one can carry a whole campaign.',
      },
      {
        title: 'Describe someone, or add photos',
        note: 'Photos keep a real face. Describing invents one, a question at a time, and anything you would rather leave to us can be skipped.',
      },
      {
        title: 'Decide the face',
        note: 'Every shot with them uses this face, so take the one you want. Try again costs nothing but time.',
      },
      {
        title: 'Save them',
        note: 'The other views are drawn from the face you took. Left unfinished, the work waits on your wall as a draft.',
      },
    ],
  },
  {
    id: 'scene',
    title: 'Build a scene',
    summary:
      'A place and its light, saved once and shot in again, so a world does not have to be described from scratch every time.',
    steps: [
      {
        title: 'Start a scene',
        note: 'A scene is where a shot happens and how it feels. Any product or presenter can be put into it.',
      },
      {
        title: 'Name it, then add a photo or a line',
        note: 'References are evidence, not backdrops: a scene reaches a shot as words, so nothing in them is copied into a picture.',
      },
      {
        title: 'Create it',
        note: 'Scenri reads the references and draws one example of the empty place. The bell says when it is there.',
      },
    ],
  },
  {
    id: 'refine',
    title: 'Refine a shot',
    summary: 'Change one thing about a shot you already have, and keep everything else, including the original.',
    steps: [
      {
        title: 'Open a shot',
        note: 'Refining starts from a picture you have made, never from an empty page.',
      },
      {
        title: 'Say one change',
        note: 'Warmer light, a closer crop, a different angle. Whatever you do not mention stays as it was.',
      },
      {
        title: 'See the change',
        note: 'It arrives as Refinement 1 on the trail under the shot, with the original one step back.',
      },
    ],
    needs: 'shot',
  },
];

/** What a lesson that needs a shot says, and does, when there is none yet. */
export const NEEDS_SHOT = {
  note: 'Refining starts from a shot you have made.',
  action: 'Make a shot first',
} as const;

export function lessonOf(id: string | null | undefined): Lesson | null {
  return LESSONS.find((l) => l.id === id) ?? null;
}

export type LessonState = 'new' | 'active' | 'done';

/**
 * In hand for this brand, done, or not begun. In hand wins over done: a
 * lesson taken again is being done again.
 *
 * Done means this lesson was walked to its end, and nothing else. The
 * install's `done` milestones say what the library proves about the product
 * (which is what stops the tutor teaching what someone clearly knows), and
 * that is a different question: owning a product is not having taken the
 * lesson about products. Lessons are independent of one another, so finishing
 * one says nothing about the rest.
 */
export function lessonState(
  id: GuideTaskId,
  view: Pick<GuideView, 'lessons' | 'active'>,
  brandId: string,
): LessonState {
  if (view.active?.task === id && view.active.brandId === brandId) return 'active';
  return view.lessons[id] ? 'done' : 'new';
}

export interface ProgressFacts {
  /** The moment the tutor would show for this task were nothing over it, when that can be said. */
  moment: string | null;
  /** What the task has sent, newest first. */
  nodes: readonly GuideTaskNode[];
  /** The presenter task has a draft of its own. */
  draft: boolean;
  /** A scene the task started is building. */
  building: boolean;
}

/** Which of a lesson's steps each of its task's moments is part of. */
const AT: Record<GuideTaskId, Record<string, number>> = {
  'first-shot': {
    go: 0,
    intro: 0,
    engine: 0,
    product: 0,
    presenter: 0,
    scene: 0,
    make: 1,
    sending: 2,
    waiting: 2,
    failed: 2,
    result: 3,
  },
  product: { product: 1 },
  presenter: { engine: 1, start: 1, face: 2, save: 3 },
  scene: { scene: 1 },
  refine: { ask: 1, 'refine-failed': 1, refining: 2, refined: 2 },
};

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
      return f.nodes.some(finished) ? 3 : f.nodes.length > 0 ? 2 : 0;
    case 'presenter':
      return f.draft ? 2 : 0;
    case 'scene':
      return f.building ? 2 : 0;
    case 'refine':
      return f.nodes.some(finished) ? 2 : f.nodes.some((n) => n.status === 'running') ? 2 : 0;
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
