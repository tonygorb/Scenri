import type { GuideTaskId, GuideTaskNode, GuideView, ShowcaseEntry } from './apiTypes.js';
import { MILESTONE } from './guidedTasks.js';

/**
 * The lessons (DESIGN.md, "First use"): each one is a real thing to do in
 * Scenri, run by the same guided task the tutor already follows. This is the
 * one list of them. First steps shows the ones marked `firstStep`, Learn shows
 * them all, and both read whether one is done, in hand or new from the same
 * install record. Nothing here stores anything: a lesson is a task, a few
 * words about it, and a picture of what it makes.
 *
 * A new lesson is a new guided task first (its rule in guidedTasks.ts, where
 * it begins in useLaunchTask.ts), and then an entry here.
 */
export interface Lesson {
  /** The guided task it runs. */
  id: GuideTaskId;
  title: string;
  /** Its First steps row while it is in hand. */
  resume: string;
  /** One sentence: what someone has at the end of it. */
  summary: string;
  /** What it walks through, as outcomes rather than clicks. */
  steps: readonly string[];
  /** Listed in First steps, the new install's short list. */
  firstStep: boolean;
  /** What it needs before it can begin. Refining needs a shot to refine. */
  needs?: 'shot';
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'first-shot',
    title: 'Make your first shot',
    resume: 'Continue your first shot',
    summary: 'Put a product, a presenter and a scene together, say how to shoot it, and Scenri makes the picture.',
    steps: ['Choose a product, a presenter and a scene', 'Say how to shoot it', 'Make the shot', 'Open it'],
    firstStep: true,
  },
  {
    id: 'product',
    title: 'Add your product',
    resume: 'Continue your product',
    summary: 'Bring in what you sell, from its photos or from your store, so every shot shows the real thing.',
    steps: ['Start a product', 'Add its photos, or bring in your store', 'Save it'],
    firstStep: false,
  },
  {
    id: 'presenter',
    title: 'Create a presenter',
    resume: 'Continue your presenter',
    summary: 'A person Scenri keeps, from a description or from photos, who shows your products in every shot.',
    steps: ['Start a presenter', 'Describe someone, or add photos', 'Decide the face', 'Save them'],
    firstStep: true,
  },
  {
    id: 'scene',
    title: 'Build a scene',
    resume: 'Continue your scene',
    summary: 'A place and its light, saved to shoot in again, from a photo or a line of direction.',
    steps: ['Start a scene', 'Name it, then add a photo or a line', 'Create it'],
    firstStep: true,
  },
  {
    id: 'refine',
    title: 'Refine a shot',
    resume: 'Continue refining',
    summary: 'Change one thing about a shot you like. The rest stays as it is, and the original is kept.',
    steps: ['Open a shot', 'Say one change', 'See the change'],
    firstStep: true,
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
 * lesson taken again is being done again. Done is the install's record,
 * latched from what the library once held, so deleting what a lesson made
 * never takes it back, and doing the thing without the tutor counts.
 */
export function lessonState(id: GuideTaskId, view: Pick<GuideView, 'done' | 'active'>, brandId: string): LessonState {
  if (view.active?.task === id && view.active.brandId === brandId) return 'active';
  return view.done[MILESTONE[id]] ? 'done' : 'new';
}

export interface StepRow {
  task: GuideTaskId;
  /** The step as the next thing to do. */
  title: string;
  state: 'todo' | 'active' | 'done';
}

/** First steps, or null when it has nothing to say or was put away. */
export function firstSteps(
  view: Pick<GuideView, 'hidden' | 'done' | 'active'> & { loaded: boolean; asked?: boolean },
): StepRow[] | null {
  if (!view.loaded || view.hidden) return null;
  const rows = LESSONS.filter((l) => l.firstStep).map((l): StepRow => {
    const state = view.done[MILESTONE[l.id]] ? 'done' : view.active?.task === l.id ? 'active' : 'todo';
    return { task: l.id, title: state === 'active' ? l.resume : l.title, state };
  });
  // Done with everything, it leaves; asked for from Help, it stays so any step can be done again.
  return rows.every((r) => r.state === 'done') && !view.asked ? null : rows;
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
  refine: { ask: 1, 'refine-failed': 1, refining: 2, refined: 3 },
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
      return f.nodes.some(finished) ? 3 : f.nodes.some((n) => n.status === 'running') ? 2 : 0;
    default:
      return 0;
  }
}

export interface LessonArt {
  showcase: readonly ShowcaseEntry[];
  presenters: readonly { avatarUrl?: string | null; previewUrl?: string | null }[];
  scenes: readonly { id: string; previewUrl?: string | null }[];
  products: readonly { previewUrl?: string | null }[];
}

/** A scene that reads as a place and its light, with nothing being sold in it. */
const PLACE = 'furniture-low-sun-terrace';

/**
 * A picture of what the lesson makes, from the curated catalog that ships
 * with Scenri: never an illustration drawn for the lesson. The shots are the
 * showcase's own, chosen by rule as the ones made from all three
 * ingredients, so the picture is what the first shot teaches.
 */
export function pictureOf(id: GuideTaskId, art: LessonArt): string | null {
  const whole = art.showcase.filter((e) => {
    const kinds = new Set((e.brief?.tokens ?? []).map((t: { t?: string }) => t?.t));
    return e.previewUrl && kinds.has('product') && kinds.has('character') && kinds.has('template');
  });
  const shot = (i: number) => (whole[i] ?? whole[0] ?? art.showcase.find((e) => e.previewUrl))?.previewUrl ?? null;
  switch (id) {
    case 'first-shot':
      return shot(0);
    case 'refine':
      return shot(1);
    case 'product':
      return art.products.find((p) => p.previewUrl)?.previewUrl ?? null;
    case 'presenter': {
      const p = art.presenters.find((x) => x.avatarUrl || x.previewUrl);
      return p?.avatarUrl ?? p?.previewUrl ?? null;
    }
    case 'scene':
      return (art.scenes.find((s) => s.id === PLACE) ?? art.scenes.find((s) => s.previewUrl))?.previewUrl ?? null;
  }
}
