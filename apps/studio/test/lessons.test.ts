import { describe, it, expect } from 'vitest';
import type { GuideTaskNode } from '../src/apiTypes.js';
import { MILESTONE } from '../src/guidedTasks.js';
import {
  LESSON_PICTURES,
  LESSONS,
  NEEDS,
  UNCOUNTED,
  countedMoments,
  lessonAt,
  lessonOf,
  lessonState,
  nextLesson,
  furthest,
  progressedPastWay,
  stepOf,
  stepOfMoment,
  stepsOf,
  type ProgressFacts,
} from '../src/lessons.js';

const DASHES = String.fromCharCode(0x2013, 0x2014);
const node = (id: string, status: string, images = 0): GuideTaskNode => ({
  id,
  kind: 'generation',
  status,
  images,
  createdAt: '2026-09-18 12:00:00.000',
});
/**
 * Every moment id each task can show. The counted ones come from the lesson's
 * own milestones; the uncounted ones are the greeting, the engine wall, and a
 * studio question that speaks for itself. This is the coverage invariant: a
 * new moment either joins a milestone or this list, never a third place.
 */
const MOMENTS: Record<string, readonly string[]> = {
  'first-shot': [...countedMoments('first-shot'), 'intro', 'engine'],
  product: [...countedMoments('product')],
  reuse: [...countedMoments('reuse'), 'engine'],
  presenter: [...countedMoments('presenter'), 'engine', 'studio'],
  scene: [...countedMoments('scene')],
  refine: [...countedMoments('refine')],
};
const facts = (over: Partial<ProgressFacts> = {}): ProgressFacts => ({
  moment: null,
  nodes: [],
  draft: false,
  ...over,
});

describe('the lessons', () => {
  it('are one list: stable ids, each a guided task the install records', () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(MILESTONE[id], id).toBeTruthy();
    expect(ids).toEqual(['first-shot', 'product', 'reuse', 'presenter', 'scene', 'refine']);
    expect(lessonOf('presenter')?.title).toBe('Create a presenter');
    expect(lessonOf('lessons')).toBeNull();
    expect(lessonOf(null)).toBeNull();
  });

  it('are outcomes, one to six of them, never a tour of clicks', () => {
    for (const l of LESSONS) {
      expect(l.milestones.length, l.id).toBeGreaterThanOrEqual(1);
      expect(l.milestones.length, l.id).toBeLessThanOrEqual(6);
      expect(stepsOf(l).length, l.id).toBe(l.milestones.length);
    }
  });

  it('opens on its first step: what pressing Start does is never a step of its own', () => {
    const first: Record<string, string> = {
      'first-shot': 'go',
      product: 'go',
      reuse: 'go',
      presenter: 'go',
      scene: 'go',
      refine: 'go',
    };
    for (const [id, moment] of Object.entries(first))
      expect(stepOfMoment(id as never, moment), id).toMatchObject({ at: 1 });
  });

  it('is the same list the tutor walks: every counted moment lands on a step, and says so', () => {
    for (const l of LESSONS)
      for (const moment of MOMENTS[l.id]) {
        const where = stepOfMoment(l.id, moment);
        if ((UNCOUNTED as readonly string[]).includes(moment)) {
          expect(where, `${l.id}: ${moment}`).toBeNull();
          continue;
        }
        expect(where, `${l.id}: ${moment}`).not.toBeNull();
        expect(where?.of, `${l.id}: ${moment}`).toBe(l.milestones.length);
        expect(where?.at, `${l.id}: ${moment}`).toBeLessThanOrEqual(l.milestones.length);
      }
  });

  it('puts each counted moment in exactly one milestone', () => {
    for (const l of LESSONS) {
      const seen = new Map<string, string>();
      for (const m of l.milestones) {
        expect(m.moments.length, `${l.id}: ${m.label}`).toBeGreaterThan(0);
        for (const moment of m.moments) {
          expect(seen.has(moment), `${l.id}: ${moment} in two milestones`).toBe(false);
          seen.set(moment, m.label);
          expect((UNCOUNTED as readonly string[]).includes(moment), `${l.id}: ${moment} is uncounted`).toBe(false);
        }
      }
    }
  });

  it('keeps its prerequisites: a shot to refine, a product of your own to use again', () => {
    expect(lessonOf('refine')?.needs).toBe('shot');
    expect(lessonOf('reuse')?.needs).toBe('product');
    for (const l of LESSONS) if (l.id !== 'refine' && l.id !== 'reuse') expect(l.needs, l.id).toBeUndefined();
    for (const k of Object.keys(NEEDS)) expect(NEEDS[k as 'shot' | 'product'].action).toBeTruthy();
  });

  it('says why the lesson matters in its summary, which the tutor never reads', () => {
    for (const l of LESSONS) {
      expect(l.summary.length, l.id).toBeGreaterThan(80);
      expect(l.summary.length, l.id).toBeLessThanOrEqual(220);
    }
  });

  it("say it in the product's words: no dash, no chrome, one or two sentences", () => {
    const copy = LESSONS.flatMap((l) => [l.title, l.summary, ...stepsOf(l)]).concat(
      Object.values(NEEDS).flatMap((n) => [n.note, n.action, n.status]),
    );
    for (const text of copy) {
      expect(text).not.toMatch(new RegExp(`[${DASHES}!]|\\bscenri\\b`));
      expect(text).not.toMatch(/\b(press|tap|click|lesson|tutorial|course|minutes?)\b|\+/i);
      expect(text.split(/[.?]\s/).filter(Boolean).length).toBeLessThanOrEqual(2);
    }
    for (const l of LESSONS) for (const step of stepsOf(l)) expect(step.split(/[.?]\s/).length, step).toBe(1);
  });
});

describe('lessonState', () => {
  const part = (brandId = 'b1', paused = false) => ({
    brandId,
    since: 'x',
    reached: ['start', 'face'],
    ...(paused ? { paused } : {}),
  });
  /** Past the first step, which is what part done means. */
  const AT = 1;
  it('is part done for its own brand, done once the record says so, new otherwise', () => {
    expect(lessonState('presenter', { lessons: {}, progress: {} }, 'b1', AT)).toBe('new');
    expect(lessonState('presenter', { lessons: { presenter: 'x' }, progress: {} }, 'b1', AT)).toBe('done');
    expect(lessonState('presenter', { lessons: {}, progress: { presenter: part() } }, 'b1', AT)).toBe('active');
    expect(lessonState('presenter', { lessons: {}, progress: { presenter: part('b1', true) } }, 'b1', AT)).toBe(
      'active',
    );
    expect(lessonState('presenter', { lessons: {}, progress: { presenter: part('b2') } }, 'b1', AT)).toBe('new');
    expect(lessonState('presenter', { lessons: { presenter: 'x' }, progress: { presenter: part() } }, 'b1', AT)).toBe(
      'active',
    );
    expect(lessonState('scene', { lessons: {}, progress: { presenter: part() } }, 'b1', AT)).toBe('new');
  });

  it('does not call a lesson standing on its first step part done', () => {
    const first = { brandId: 'b1', since: 'x', reached: ['go'] };
    expect(lessonState('presenter', { lessons: {}, progress: { presenter: first } }, 'b1', 0)).toBe('new');
    expect(lessonState('presenter', { lessons: {}, progress: { presenter: { ...first, reached: [] } } }, 'b1', 1)).toBe(
      'active',
    );
    expect(lessonState('presenter', { lessons: {}, progress: { presenter: { ...first, reached: [] } } }, 'b1', 0)).toBe(
      'new',
    );
    expect(furthest('first-shot', ['go', 'engine'])).toBe(0);
    expect(progressedPastWay('refine', ['go'])).toBe(false);
    expect(progressedPastWay('refine', ['go', 'choose'])).toBe(true);
  });

  it('puts Next on the first lesson that is not done, not a later one in hand', () => {
    const state: Record<string, 'new' | 'active' | 'done'> = {
      'first-shot': 'new',
      product: 'done',
      reuse: 'active',
      presenter: 'active',
      scene: 'active',
      refine: 'active',
    };
    expect(nextLesson(LESSONS, (l) => state[l.id])?.id).toBe('first-shot');
    state['first-shot'] = 'done';
    expect(nextLesson(LESSONS, (l) => state[l.id])?.id).toBe('reuse');
    for (const id of Object.keys(state)) state[id] = 'done';
    expect(nextLesson(LESSONS, (l) => state[l.id])).toBeNull();
    for (const id of Object.keys(state)) state[id] = 'new';
    expect(nextLesson(LESSONS, (l) => state[l.id])?.id).toBe('first-shot');
    state['first-shot'] = 'active';
    expect(nextLesson(LESSONS, (l) => state[l.id])?.id).toBe('first-shot');
  });

  it('reads a record that has no progress at all rather than throwing on it', () => {
    const old = { lessons: { presenter: 'x' } } as Parameters<typeof lessonState>[1];
    expect(lessonState('presenter', old, 'b1', AT)).toBe('done');
    expect(lessonState('scene', old, 'b1', AT)).toBe('new');
  });

  it('reads the furthest milestone a lesson has reached, in any order', () => {
    expect(furthest('first-shot', [])).toBe(0);
    expect(furthest('first-shot', ['go', 'product'])).toBe(1);
    expect(furthest('first-shot', ['make', 'go', 'scene'])).toBe(4);
    expect(furthest('first-shot', ['face', 'nonsense'])).toBe(0);
    expect(furthest('product', ['go', 'new'])).toBe(1);
    expect(furthest('refine', ['choose', 'ask'])).toBe(2);
  });

  it('never promises a step neither the moments nor the record-only switch can reach', () => {
    for (const l of LESSONS) {
      const last = l.milestones.length - 1;
      const reachedByMoment = MOMENTS[l.id]
        .map((m) => stepOfMoment(l.id, m)?.at)
        .filter((at): at is number => at !== undefined);
      expect(Math.max(...reachedByMoment), l.id).toBe(l.milestones.length);
      for (const status of ['done', 'running', 'error', 'cancelled'])
        for (const images of [0, 1])
          for (const draft of [false, true]) {
            const at = stepOf(l.id, facts({ nodes: [node('n', status, images)], draft }));
            expect(at, `${l.id}: ${status}/${images}/${draft}`).toBeLessThanOrEqual(last);
          }
    }
  });
});

describe('stepOf', () => {
  it("reads the tutor's own moment when there is one", () => {
    expect(stepOf('first-shot', facts({ moment: 'product' }))).toBe(1);
    expect(stepOf('first-shot', facts({ moment: 'presenter' }))).toBe(2);
    expect(stepOf('first-shot', facts({ moment: 'scene' }))).toBe(3);
    expect(stepOf('first-shot', facts({ moment: 'make' }))).toBe(4);
    expect(stepOf('first-shot', facts({ moment: 'result' }))).toBe(5);
    expect(stepOf('reuse', facts({ moment: 'product' }))).toBe(1);
    expect(stepOf('reuse', facts({ moment: 'again' }))).toBe(4);
    expect(stepOf('presenter', facts({ moment: 'go' }))).toBe(0);
    expect(stepOf('presenter', facts({ moment: 'new' }))).toBe(1);
    expect(stepOf('presenter', facts({ moment: 'start' }))).toBe(2);
    expect(stepOf('presenter', facts({ moment: 'face' }))).toBe(3);
    expect(stepOf('presenter', facts({ moment: 'save' }))).toBe(4);
    expect(stepOf('refine', facts({ moment: 'go' }))).toBe(0);
    expect(stepOf('refine', facts({ moment: 'choose' }))).toBe(1);
    expect(stepOf('refine', facts({ moment: 'ask' }))).toBe(2);
    expect(stepOf('refine', facts({ moment: 'refined' }))).toBe(3);
    expect(stepOf('product', facts({ moment: 'product' }))).toBe(2);
    expect(stepOf('scene', facts({ moment: 'scene' }))).toBe(2);
  });

  it('never points at a step a lesson does not have', () => {
    for (const l of LESSONS) {
      const last = l.milestones.length - 1;
      for (const moment of MOMENTS[l.id]) {
        const at = stepOf(l.id, facts({ moment }));
        expect(at, `${l.id}: ${moment}`).toBeGreaterThanOrEqual(0);
        expect(at, `${l.id}: ${moment}`).toBeLessThanOrEqual(last);
      }
    }
  });

  it("Learn ignores another lesson's moment and another task's nodes", () => {
    const reached = ['go', 'product'] as const;
    // a full brief on Create is first-shot's make, but that walk is not this one
    expect(lessonAt('first-shot', reached, { moment: 'make', nodes: [], draft: false })).toBe(4);
    expect(lessonAt('first-shot', reached, null)).toBe(1);
    // refine's finished edit is not first-shot's picture
    expect(lessonAt('first-shot', reached, { moment: null, nodes: [node('x', 'done', 1)], draft: false })).toBe(5);
    expect(lessonAt('reuse', ['product'], { moment: 'make', nodes: [], draft: false })).toBe(3);
    expect(lessonAt('reuse', ['product'], null)).toBe(1);
    expect(lessonAt('presenter', ['new'], { moment: 'save', nodes: [], draft: true })).toBe(4);
    expect(lessonAt('presenter', ['new'], null)).toBe(1);
  });

  it('otherwise goes no further than the record proves', () => {
    expect(stepOf('first-shot', facts())).toBe(0);
    expect(stepOf('first-shot', facts({ nodes: [node('a', 'running')] }))).toBe(4);
    expect(stepOf('first-shot', facts({ nodes: [node('a', 'done', 1)] }))).toBe(5);
    expect(stepOf('first-shot', facts({ nodes: [node('a', 'done', 0)] }))).toBe(4);
    expect(stepOf('reuse', facts({ nodes: [node('a', 'done', 1)] }))).toBe(4);
    expect(stepOf('presenter', facts())).toBe(0);
    expect(stepOf('presenter', facts({ draft: true }))).toBe(3);
    expect(stepOf('scene', facts())).toBe(0);
    expect(stepOf('product', facts())).toBe(0);
    expect(stepOf('refine', facts({ nodes: [node('e', 'running')] }))).toBe(3);
  });
});

describe('LESSON_PICTURES', () => {
  it('gives every lesson its own square and its own wide picture', () => {
    const all = LESSONS.flatMap((l) => [LESSON_PICTURES[l.id].square, LESSON_PICTURES[l.id].wide]);
    for (const l of LESSONS) {
      expect(LESSON_PICTURES[l.id].square, l.id).toMatch(new RegExp(`/lessons/${l.id}-square\\.webp$`));
      expect(LESSON_PICTURES[l.id].wide, l.id).toMatch(new RegExp(`/lessons/${l.id}-wide\\.webp$`));
    }
    expect(new Set(all).size).toBe(all.length);
  });
});
