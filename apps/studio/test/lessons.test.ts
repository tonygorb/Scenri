import { describe, it, expect } from 'vitest';
import type { GuideTaskNode, ShowcaseEntry } from '../src/apiTypes.js';
import { MILESTONE } from '../src/guidedTasks.js';
import {
  LESSONS,
  NEEDS_SHOT,
  firstSteps,
  lessonOf,
  lessonState,
  pictureOf,
  stepOf,
  type LessonArt,
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
    const copy = LESSONS.flatMap((l) => [l.title, l.resume, l.summary, ...l.steps]).concat(Object.values(NEEDS_SHOT));
    for (const text of copy) {
      expect(text).not.toMatch(new RegExp(`[${DASHES}!]|\\bscenri\\b`));
      expect(text).not.toMatch(/\b(press|tap|click|lesson|tutorial|course|minutes?)\b|\+/i);
      expect(text.split(/[.?]\s/).filter(Boolean).length).toBeLessThanOrEqual(2);
    }
  });

  it('First steps is a subset of them, in the same order', () => {
    const first = LESSONS.filter((l) => l.firstStep).map((l) => l.id);
    expect(first).toEqual(['first-shot', 'presenter', 'scene', 'refine']);
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
    expect(lessonState('presenter', { done: {}, active: null }, 'b1')).toBe('new');
    expect(lessonState('presenter', { done: { presenter: 'x' }, active: null }, 'b1')).toBe('done');
    expect(lessonState('presenter', { done: {}, active: active('presenter') }, 'b1')).toBe('active');
    // another brand's task in hand is that brand's
    expect(lessonState('presenter', { done: {}, active: active('presenter', 'b2') }, 'b1')).toBe('new');
    // taken again, it is being done again
    expect(lessonState('presenter', { done: { presenter: 'x' }, active: active('presenter') }, 'b1')).toBe('active');
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

describe('pictureOf', () => {
  const entry = (id: string, kinds: string[]): ShowcaseEntry =>
    ({
      id,
      title: id,
      category: 'x',
      width: 1024,
      height: 1280,
      previewUrl: `/api/showcase-previews/${id}.jpg`,
      brief: { tokens: kinds.map((t) => ({ t, id: `${t}-1` })) },
    }) as ShowcaseEntry;
  const art: LessonArt = {
    showcase: [
      entry('product-only', ['product', 'template']),
      entry('all-three', ['product', 'character', 'template']),
      entry('all-three-again', ['template', 'character', 'product']),
    ],
    presenters: [{ previewUrl: '/p/card.jpg', avatarUrl: '/p/face.jpg' }],
    scenes: [
      { id: 'studio', previewUrl: '/s/studio.jpg' },
      { id: 'furniture-low-sun-terrace', previewUrl: '/s/terrace.jpg' },
    ],
    products: [{ previewUrl: null }, { previewUrl: '/d/watch.jpg' }],
  };
  it('shows what the lesson makes, from the catalog that ships', () => {
    // the shots teach the first shot: made from all three ingredients
    expect(pictureOf('first-shot', art)).toBe('/api/showcase-previews/all-three.jpg');
    expect(pictureOf('refine', art)).toBe('/api/showcase-previews/all-three-again.jpg');
    // a face, not a torso cropped to a card
    expect(pictureOf('presenter', art)).toBe('/p/face.jpg');
    // a place and its light, with nothing sold in it
    expect(pictureOf('scene', art)).toBe('/s/terrace.jpg');
    expect(pictureOf('product', art)).toBe('/d/watch.jpg');
  });
  it('never fails for an empty catalog', () => {
    const none: LessonArt = { showcase: [], presenters: [], scenes: [], products: [] };
    for (const l of LESSONS) expect(pictureOf(l.id, none)).toBeNull();
  });
});

describe('firstSteps', () => {
  const view = (over: Partial<Parameters<typeof firstSteps>[0]> = {}) => ({
    loaded: true,
    hidden: false,
    eligible: true,
    welcome: 'taken' as const,
    done: {},
    active: null,
    ...over,
  });

  it('waits for the record, shows from the start, and stays away when hidden', () => {
    expect(firstSteps(view({ loaded: false }))).toBeNull();
    expect(firstSteps(view({ hidden: true }))).toBeNull();
    expect(firstSteps(view({ welcome: null }))).not.toBeNull();
  });

  it('lists four real things, ticked by what exists and dotted for the one in hand', () => {
    const rows = firstSteps(
      view({
        done: { shot: 'x' },
        active: { task: 'presenter', brandId: 'b', since: 'x', baseline: { products: 0, presenters: 0, scenes: 0 } },
      }),
    );
    expect(rows?.map((r) => [r.task, r.state, r.title])).toEqual([
      ['first-shot', 'done', 'Make your first shot'],
      ['presenter', 'active', 'Continue your presenter'],
      ['scene', 'todo', 'Build a scene'],
      ['refine', 'todo', 'Refine a shot'],
    ]);
  });

  it('leaves once everything is done, unless it was asked for from Help', () => {
    const all = { shot: 'a', refine: 'b', presenter: 'd', scene: 'e' };
    expect(firstSteps(view({ done: all }))).toBeNull();
    expect(firstSteps(view({ done: all, asked: true }))?.every((r) => r.state === 'done')).toBe(true);
    expect(firstSteps(view({ welcome: null, asked: true }))).not.toBeNull();
    expect(firstSteps(view({ done: all, asked: true, hidden: true }))).toBeNull();
  });
});
