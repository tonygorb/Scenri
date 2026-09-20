import { describe, it, expect } from 'vitest';
import type { GuideTaskNode } from '../src/apiTypes.js';
import { MILESTONE } from '../src/guidedTasks.js';
import {
  LESSON_PICTURES,
  LESSONS,
  NEEDS,
  lessonOf,
  lessonState,
  furthest,
  stepOf,
  stepOfMoment,
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
/** Every moment id each task can show, so no lesson can tick a step it lacks. */
const MOMENTS: Record<string, readonly string[]> = {
  'first-shot': [
    'go',
    'intro',
    'engine',
    'product',
    'presenter',
    'scene',
    'make',
    'sending',
    'waiting',
    'failed',
    'result',
  ],
  product: ['product'],
  reuse: ['go', 'engine', 'product', 'scene', 'make', 'sending', 'waiting', 'failed', 'again'],
  presenter: ['engine', 'start', 'face', 'save'],
  scene: ['scene'],
  refine: ['ask', 'refine-failed', 'refining', 'refined'],
};
const facts = (over: Partial<ProgressFacts> = {}): ProgressFacts => ({
  moment: null,
  nodes: [],
  draft: false,
  building: false,
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

  it('are outcomes, two to six of them, never a tour of clicks', () => {
    for (const l of LESSONS) {
      // two is the floor because some walks really are two moments long: the
      // product dialog says one thing and then the product exists
      expect(l.steps.length, l.id).toBeGreaterThanOrEqual(2);
      expect(l.steps.length, l.id).toBeLessThanOrEqual(6);
    }
  });

  it('opens on its first step: what pressing Start does is never a step of its own', () => {
    // every walk used to open on "2 of 3", because the list began with the
    // thing the launch had already done
    const first: Record<string, string> = {
      'first-shot': 'go',
      product: 'product',
      reuse: 'go',
      presenter: 'start',
      scene: 'scene',
      refine: 'ask',
    };
    for (const [id, moment] of Object.entries(first))
      expect(stepOfMoment(id as never, moment), id).toMatchObject({ at: 1 });
  });

  it('is the same list the tutor walks: every moment lands on a step, and says so', () => {
    for (const l of LESSONS)
      for (const moment of MOMENTS[l.id]) {
        const where = stepOfMoment(l.id, moment);
        // the greeting is the one moment with no step of its own
        if (moment === 'intro') continue;
        expect(where, `${l.id}: ${moment}`).not.toBeNull();
        expect(where?.of, `${l.id}: ${moment}`).toBe(l.steps.length);
        expect(where?.at, `${l.id}: ${moment}`).toBeLessThanOrEqual(l.steps.length);
      }
  });

  it('keeps its prerequisites: a shot to refine, a product of your own to use again', () => {
    // dropped once in a rewrite, which silently offered Start with nothing to open
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
    const copy = LESSONS.flatMap((l) => [l.title, l.summary, ...l.steps]).concat(
      Object.values(NEEDS).flatMap((n) => [n.note, n.action, n.status]),
    );
    for (const text of copy) {
      expect(text).not.toMatch(new RegExp(`[${DASHES}!]|\\bscenri\\b`));
      expect(text).not.toMatch(/\b(press|tap|click|lesson|tutorial|course|minutes?)\b|\+/i);
      expect(text.split(/[.?]\s/).filter(Boolean).length).toBeLessThanOrEqual(2);
    }
    for (const l of LESSONS) for (const step of l.steps) expect(step.split(/[.?]\s/).length, step).toBe(1);
  });
});

describe('lessonState', () => {
  const part = (brandId = 'b1', paused = false) => ({
    brandId,
    since: 'x',
    reached: ['start'],
    ...(paused ? { paused } : {}),
  });
  it('is part done for its own brand, done once the record says so, new otherwise', () => {
    expect(lessonState('presenter', { lessons: {}, progress: {} }, 'b1')).toBe('new');
    expect(lessonState('presenter', { lessons: { presenter: 'x' }, progress: {} }, 'b1')).toBe('done');
    expect(lessonState('presenter', { lessons: {}, progress: { presenter: part() } }, 'b1')).toBe('active');
    // set down for another lesson, it is still part done and still says Continue
    expect(lessonState('presenter', { lessons: {}, progress: { presenter: part('b1', true) } }, 'b1')).toBe('active');
    // another brand's work is that brand's
    expect(lessonState('presenter', { lessons: {}, progress: { presenter: part('b2') } }, 'b1')).toBe('new');
    // taken again, it is being done again
    expect(lessonState('presenter', { lessons: { presenter: 'x' }, progress: { presenter: part() } }, 'b1')).toBe(
      'active',
    );
    // and one lesson's progress says nothing about another's
    expect(lessonState('scene', { lessons: {}, progress: { presenter: part() } }, 'b1')).toBe('new');
  });

  it('reads the furthest milestone a lesson has reached, in any order', () => {
    expect(furthest('first-shot', [])).toBe(0);
    expect(furthest('first-shot', ['go', 'product'])).toBe(1);
    expect(furthest('first-shot', ['make', 'go', 'scene'])).toBe(4);
    // a milestone from another lesson, or one that no longer maps, counts for nothing
    expect(furthest('first-shot', ['face', 'nonsense'])).toBe(0);
  });
});

describe('stepOf', () => {
  it("reads the tutor's own moment when there is one", () => {
    // one milestone per ingredient now, so each ask ticks its own
    expect(stepOf('first-shot', facts({ moment: 'product' }))).toBe(1);
    expect(stepOf('first-shot', facts({ moment: 'presenter' }))).toBe(2);
    expect(stepOf('first-shot', facts({ moment: 'scene' }))).toBe(3);
    expect(stepOf('first-shot', facts({ moment: 'make' }))).toBe(4);
    expect(stepOf('first-shot', facts({ moment: 'result' }))).toBe(5);
    expect(stepOf('reuse', facts({ moment: 'product' }))).toBe(1);
    expect(stepOf('reuse', facts({ moment: 'again' }))).toBe(4);
    expect(stepOf('presenter', facts({ moment: 'face' }))).toBe(1);
    expect(stepOf('presenter', facts({ moment: 'save' }))).toBe(2);
    // the last step there is, never one past it: the tick has to exist
    expect(stepOf('refine', facts({ moment: 'refined' }))).toBe(1);
  });

  it('never points at a step a lesson does not have', () => {
    for (const l of LESSONS) {
      const last = l.steps.length - 1;
      for (const moment of MOMENTS[l.id]) {
        const at = stepOf(l.id, facts({ moment }));
        expect(at, `${l.id}: ${moment}`).toBeGreaterThanOrEqual(0);
        expect(at, `${l.id}: ${moment}`).toBeLessThanOrEqual(last);
      }
    }
  });

  it('otherwise goes no further than the record proves', () => {
    expect(stepOf('first-shot', facts())).toBe(0);
    expect(stepOf('first-shot', facts({ nodes: [node('a', 'running')] }))).toBe(4);
    expect(stepOf('first-shot', facts({ nodes: [node('a', 'done', 1)] }))).toBe(5);
    // a take that finished with nothing is not a shot
    expect(stepOf('first-shot', facts({ nodes: [node('a', 'done', 0)] }))).toBe(4);
    expect(stepOf('reuse', facts({ nodes: [node('a', 'done', 1)] }))).toBe(4);
    expect(stepOf('presenter', facts())).toBe(0);
    expect(stepOf('presenter', facts({ draft: true }))).toBe(1);
    expect(stepOf('scene', facts({ building: true }))).toBe(1);
    expect(stepOf('product', facts())).toBe(0);
    expect(stepOf('refine', facts({ nodes: [node('e', 'running')] }))).toBe(1);
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
