import { describe, it, expect } from 'vitest';
import type { GuideTaskNode } from '../src/apiTypes.js';
import { MILESTONE } from '../src/guidedTasks.js';
import {
  LESSON_PICTURES,
  LESSONS,
  NEEDS_SHOT,
  lessonOf,
  lessonState,
  stepOf,
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
    expect(ids).toEqual(['first-shot', 'product', 'presenter', 'scene', 'refine']);
    expect(lessonOf('presenter')?.title).toBe('Create a presenter');
    expect(lessonOf('lessons')).toBeNull();
    expect(lessonOf(null)).toBeNull();
  });

  it('are outcomes, three to five steps each, never a tour of clicks', () => {
    for (const l of LESSONS) {
      expect(l.steps.length, l.id).toBeGreaterThanOrEqual(3);
      expect(l.steps.length, l.id).toBeLessThanOrEqual(5);
    }
  });

  it("say it in the product's words: no dash, no chrome, one or two sentences", () => {
    const copy = LESSONS.flatMap((l) => [l.title, l.summary, ...l.steps]).concat(Object.values(NEEDS_SHOT));
    for (const text of copy) {
      expect(text).not.toMatch(new RegExp(`[${DASHES}!]|\\bscenri\\b`));
      expect(text).not.toMatch(/\b(press|tap|click|lesson|tutorial|course|minutes?)\b|\+/i);
      expect(text.split(/[.?]\s/).filter(Boolean).length).toBeLessThanOrEqual(2);
    }
  });
});

describe('lessonState', () => {
  const active = (task: 'presenter' | 'first-shot', brandId = 'b1') => ({
    task,
    brandId,
    since: 'x',
    baseline: { products: 0, presenters: 0, scenes: 0 },
  });
  it('is in hand for its own brand, done once the record says so, new otherwise', () => {
    expect(lessonState('presenter', { lessons: {}, active: null }, 'b1')).toBe('new');
    expect(lessonState('presenter', { lessons: { presenter: 'x' }, active: null }, 'b1')).toBe('done');
    expect(lessonState('presenter', { lessons: {}, active: active('presenter') }, 'b1')).toBe('active');
    // another brand's task in hand is that brand's
    expect(lessonState('presenter', { lessons: {}, active: active('presenter', 'b2') }, 'b1')).toBe('new');
    // taken again, it is being done again
    expect(lessonState('presenter', { lessons: { presenter: 'x' }, active: active('presenter') }, 'b1')).toBe('active');
  });
});

describe('stepOf', () => {
  it("reads the tutor's own moment when there is one", () => {
    expect(stepOf('first-shot', facts({ moment: 'presenter' }))).toBe(0);
    expect(stepOf('first-shot', facts({ moment: 'make' }))).toBe(1);
    expect(stepOf('first-shot', facts({ moment: 'waiting' }))).toBe(2);
    expect(stepOf('first-shot', facts({ moment: 'result' }))).toBe(3);
    expect(stepOf('presenter', facts({ moment: 'face' }))).toBe(2);
    expect(stepOf('presenter', facts({ moment: 'save' }))).toBe(3);
    expect(stepOf('refine', facts({ moment: 'refined' }))).toBe(3);
  });

  it('otherwise goes no further than the record proves', () => {
    expect(stepOf('first-shot', facts())).toBe(0);
    expect(stepOf('first-shot', facts({ nodes: [node('a', 'running')] }))).toBe(2);
    expect(stepOf('first-shot', facts({ nodes: [node('a', 'done', 1)] }))).toBe(3);
    // a take that finished with nothing is not a shot
    expect(stepOf('first-shot', facts({ nodes: [node('a', 'done', 0)] }))).toBe(2);
    expect(stepOf('presenter', facts())).toBe(0);
    expect(stepOf('presenter', facts({ draft: true }))).toBe(2);
    expect(stepOf('scene', facts({ building: true }))).toBe(2);
    expect(stepOf('product', facts())).toBe(0);
    expect(stepOf('refine', facts({ nodes: [node('e', 'running')] }))).toBe(2);
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
