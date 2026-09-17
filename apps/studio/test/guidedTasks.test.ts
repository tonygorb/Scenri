import { describe, it, expect } from 'vitest';
import type { GuideTaskNode, GuideView, ShowcaseEntry } from '../src/apiTypes.js';
import type { ComposerFacts } from '../src/guideFacts.js';
import {
  COPY,
  WELCOME,
  assetStep,
  canWelcome,
  firstShotStep,
  firstSteps,
  madeOne,
  mergeTaskNodes,
  presenterStep,
  refineStep,
  startsHere,
  welcomeSet,
  type ContextStart,
  type WelcomeInput,
} from '../src/guidedTasks.js';

/** En and em dash, spelled by code point so no dash sits in this file. */
const DASHES = String.fromCharCode(0x2013, 0x2014);

const composer = (over: Partial<ComposerFacts> = {}): ComposerFacts => ({
  brandId: 'b1',
  products: 0,
  presenters: 0,
  scene: false,
  words: false,
  canGo: false,
  busy: false,
  pickerOpen: false,
  refining: false,
  engine: 'ready',
  ...over,
});
const node = (
  id: string,
  status: string,
  images = 0,
  createdAt = `2026-09-17 12:00:0${id.length}.000`,
): GuideTaskNode => ({
  id,
  kind: 'generation',
  status,
  images,
  createdAt,
});

describe('the first shot, from the outcome back', () => {
  const step = (c: ComposerFacts | null, nodes: GuideTaskNode[] = [], here = true) =>
    firstShotStep({ here, composer: c, nodes })?.id ?? null;

  it('says nothing away from Create, or before its composer has spoken', () => {
    expect(step(composer(), [], false)).toBeNull();
    expect(step(null)).toBeNull();
  });

  it('walks the brief: add, pick, picked, brief', () => {
    expect(step(composer())).toBe('add');
    expect(step(composer({ pickerOpen: true }))).toBe('pick');
    expect(step(composer({ pickerOpen: true, products: 1 }))).toBe('picked');
    expect(step(composer({ products: 1, canGo: true }))).toBe('brief');
  });

  it('closing the picker with nothing picked goes back to add, never on to the brief', () => {
    expect(step(composer({ pickerOpen: false, products: 0, presenters: 1, words: true }))).toBe('add');
  });

  it('a presenter, a scene or words alone are not a shot: the product comes first', () => {
    expect(step(composer({ presenters: 1, scene: true, words: true, canGo: true }))).toBe('add');
  });

  it('with no engine, the setup comes before anything else to build', () => {
    const g = firstShotStep({ here: true, composer: composer({ engine: 'setup', products: 1 }), nodes: [] });
    expect(g?.id).toBe('engine');
    expect(g?.target).toBe('[data-guide="compose.engine"]');
    expect(g?.voice).toBe('coach');
  });

  it('a send in flight is quiet, and the emptied brief after it reads as waiting', () => {
    expect(step(composer({ busy: true, products: 1 }))).toBe('sending');
    expect(step(composer(), [node('n1', 'running')])).toBe('waiting');
    expect(step(composer({ engine: 'setup' }), [node('n1', 'running')])).toBe('waiting');
  });

  it('a finished picture ends it on its own tile, even beside a failed sibling', () => {
    const g = firstShotStep({
      here: true,
      composer: composer(),
      nodes: [node('n2', 'error'), node('n1', 'done', 1)],
    });
    expect(g?.id).toBe('result');
    expect(g?.target).toBe('.sc-feed .sc-cell[data-fb-node="n1"]');
    expect(g?.done).toBe(true);
    expect(g?.voice).toBe('card');
  });

  it('done with no picture is a failure, never a shot', () => {
    expect(step(composer(), [node('n1', 'done', 0)])).toBe('failed');
  });

  it('every take failed: the card waits on the newest tile until the brief is being built again', () => {
    const g = firstShotStep({
      here: true,
      composer: composer(),
      nodes: [node('n2', 'cancelled'), node('n1', 'error')],
    });
    expect(g?.id).toBe('failed');
    expect(g?.target).toContain('n2');
    expect(step(composer({ pickerOpen: true }), [node('n1', 'error')])).toBe('pick');
    expect(step(composer({ products: 1 }), [node('n1', 'error')])).toBe('brief');
  });

  it('a refine armed in the composer is not the first shot', () => {
    expect(step(composer({ refining: true, products: 1 }))).toBeNull();
  });

  it('while the picker is open the words sit inside it and the curtain keeps the composer open', () => {
    const g = firstShotStep({ here: true, composer: composer({ pickerOpen: true }), nodes: [] });
    expect(g?.slot).toBe('picker');
    expect(g?.target).toBeUndefined();
    expect(g?.surfaces).toEqual(['[data-guide="compose"]', '[data-guide="compose"] .sc-attachpanel']);
  });
});

describe('the later tasks', () => {
  it('refine: the change, then quiet while it draws, then the new version', () => {
    expect(refineStep({ here: false, nodes: [] })).toBeNull();
    expect(refineStep({ here: true, nodes: [] })?.body).toBe(COPY.refineAsk);
    expect(refineStep({ here: true, nodes: [{ ...node('e1', 'running'), kind: 'edit' }] })?.voice).toBe('quiet');
    const done = refineStep({ here: true, nodes: [{ ...node('e1', 'done', 1), kind: 'edit' }] });
    expect(done?.body).toBe(COPY.refineResult);
    expect(done?.done).toBe(true);
  });

  it('presenter: a word at the source and at the face, quiet through every other question', () => {
    expect(presenterStep(null)).toBeNull();
    expect(presenterStep({ open: 'source' })?.body).toBe(COPY.presenterStart);
    expect(presenterStep({ open: 'identity' })?.body).toBe(COPY.presenterFace);
    for (const open of ['photos', 'look-who', 'describe', 'traits', 'keep', 'extras', 'name', null])
      expect(presenterStep({ open })?.voice).toBe('quiet');
  });

  it('product and scene: a word in their own dialog, nothing when it is closed', () => {
    expect(assetStep('product', false)).toBeNull();
    expect(assetStep('product', true)?.slot).toBe('dialog:product');
    expect(assetStep('scene', true)?.body).toBe(COPY.scene);
  });

  it('a task that makes something ends when the brand holds one more than when it began', () => {
    const view = (task: 'product' | 'presenter' | 'scene' | 'refine') =>
      ({
        active: { task, brandId: 'b1', since: 'x', baseline: { products: 2, presenters: 0, scenes: 1 } },
        counts: null,
      }) as Pick<GuideView, 'active' | 'counts'>;
    expect(madeOne(view('product'), { products: 2, presenters: 5, scenes: 5 })).toBe(false);
    expect(madeOne(view('product'), { products: 3, presenters: 0, scenes: 1 })).toBe(true);
    expect(madeOne(view('presenter'), { products: 2, presenters: 1, scenes: 1 })).toBe(true);
    expect(madeOne(view('scene'), { products: 9, presenters: 9, scenes: 1 })).toBe(false);
    expect(madeOne(view('refine'), { products: 9, presenters: 9, scenes: 9 })).toBe(false);
  });
});

describe('startsHere', () => {
  const s = (over: Partial<ContextStart> = {}): ContextStart => ({
    eligible: true,
    hidden: false,
    done: { shot: 'x' },
    dismissed: [],
    active: null,
    ...over,
  });

  it('begins a surface task for someone new, once', () => {
    expect(startsHere('scene', s())).toBe(true);
    expect(startsHere('scene', s({ eligible: false }))).toBe(false);
    expect(startsHere('scene', s({ hidden: true }))).toBe(false);
    expect(startsHere('scene', s({ done: { shot: 'x', scene: 'y' } }))).toBe(false);
    expect(startsHere('scene', s({ dismissed: ['scene'] }))).toBe(false);
  });

  it('never chains: another task in hand holds it back', () => {
    expect(
      startsHere(
        'scene',
        s({
          active: { task: 'product', brandId: 'b', since: 'x', baseline: { products: 0, presenters: 0, scenes: 0 } },
        }),
      ),
    ).toBe(false);
  });

  it('refining waits for a first shot', () => {
    expect(startsHere('refine', s({ done: {} }))).toBe(false);
    expect(startsHere('refine', s())).toBe(true);
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

  it('waits for the record and the welcome, and stays away when hidden', () => {
    expect(firstSteps(view({ loaded: false }))).toBeNull();
    expect(firstSteps(view({ hidden: true }))).toBeNull();
    expect(firstSteps(view({ welcome: null }))).toBeNull();
    expect(firstSteps(view({ eligible: false, welcome: null }))).not.toBeNull();
  });

  it('lists the five tasks, ticked by what exists and dotted for the one in hand', () => {
    const rows = firstSteps(
      view({
        done: { shot: 'x', product: 'y' },
        active: { task: 'presenter', brandId: 'b', since: 'x', baseline: { products: 0, presenters: 0, scenes: 0 } },
      }),
    );
    expect(rows?.map((r) => [r.task, r.state])).toEqual([
      ['first-shot', 'done'],
      ['refine', 'todo'],
      ['product', 'done'],
      ['presenter', 'active'],
      ['scene', 'todo'],
    ]);
  });

  it('leaves once everything is done', () => {
    expect(firstSteps(view({ done: { shot: 'a', refine: 'b', product: 'c', presenter: 'd', scene: 'e' } }))).toBeNull();
  });
});

describe('canWelcome', () => {
  const input = (over: Partial<WelcomeInput> = {}): WelcomeInput => ({
    onMainPage: true,
    eligible: true,
    welcome: null,
    ready: true,
    visible: true,
    blocked: false,
    busy: false,
    ...over,
  });

  it('welcomes someone new on a ready, quiet main page, once', () => {
    expect(canWelcome(input())).toBe(true);
    for (const over of [
      { onMainPage: false },
      { eligible: false },
      { welcome: 'declined' as const },
      { ready: false },
      { visible: false },
      { blocked: true },
      { busy: true },
    ])
      expect(canWelcome(input(over))).toBe(false);
  });
});

describe('mergeTaskNodes', () => {
  const rec = (id: string, status: string, createdAt: string, kind = 'generation', images: unknown[] = []) => ({
    id,
    kind,
    status,
    images,
    createdAt,
  });

  it('takes only what the task sent, of its kind, since it began, newest first', () => {
    const since = '2026-09-17 12:00:00.000';
    const merged = mergeTaskNodes(
      [],
      [
        rec('old', 'running', '2026-09-17 11:59:59.999'),
        rec('edit', 'running', '2026-09-17 12:00:01.000', 'edit'),
        rec('a', 'running', '2026-09-17 12:00:01.000'),
        rec('b', 'done', '2026-09-17 12:00:02.000', 'generation', ['h1']),
      ],
      since,
      'generation',
    );
    expect(merged.map((n) => [n.id, n.status, n.images])).toEqual([
      ['b', 'done', 1],
      ['a', 'running', 0],
    ]);
  });

  it('moves a node on as it settles, and hands back the same list when nothing changed', () => {
    const since = '2026-09-17 12:00:00.000';
    const first = mergeTaskNodes([], [rec('a', 'running', '2026-09-17 12:00:01.000')], since, 'generation');
    expect(mergeTaskNodes(first, [rec('a', 'running', '2026-09-17 12:00:01.000')], since, 'generation')).toBe(first);
    const settled = mergeTaskNodes(
      first,
      [rec('a', 'done', '2026-09-17 12:00:01.000', 'generation', ['h'])],
      since,
      'generation',
    );
    expect(settled[0]).toMatchObject({ id: 'a', status: 'done', images: 1 });
  });
});

describe('welcomeSet', () => {
  const entry = (id: string, product: string | null, scene: string | null, pic = true) =>
    ({
      id,
      title: id,
      category: 'x',
      width: 1,
      height: 1,
      previewUrl: pic ? `/p/${id}` : null,
      brief: {
        tokens: [...(product ? [{ t: 'product', id: product }] : []), ...(scene ? [{ t: 'template', id: scene }] : [])],
      },
    }) as ShowcaseEntry;

  it('shows the first product in wall order that appears in three different worlds', () => {
    const wall = [
      entry('a', 'serum', 'dew'),
      entry('b', 'shoe', 'ash'),
      entry('c', 'serum', 'dew'),
      entry('d', 'shoe', 'ash'),
      entry('e', 'shoe', 'dune'),
      entry('f', 'serum', 'silk'),
      entry('g', 'shoe', 'neon'),
    ];
    expect(welcomeSet(wall).map((e) => e.id)).toEqual(['b', 'e', 'g']);
  });

  it('falls back to three of one product, then to the first three pictures', () => {
    expect(
      welcomeSet([entry('a', 'x', null), entry('b', 'y', null), entry('c', 'x', null), entry('d', 'x', 's')]).map(
        (e) => e.id,
      ),
    ).toEqual(['a', 'c', 'd']);
    expect(
      welcomeSet([
        entry('a', null, null, false),
        entry('b', 'x', null),
        entry('c', 'y', null),
        entry('d', null, null),
      ]).map((e) => e.id),
    ).toEqual(['b', 'c', 'd']);
  });
});

describe('the copy', () => {
  const strings = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
  const copy = [
    ...strings(COPY),
    WELCOME.lede,
    WELCOME.take,
    WELCOME.notNow,
    WELCOME.note({ engineReady: false, ownsProducts: false }),
    WELCOME.note({ engineReady: true, ownsProducts: false }),
    WELCOME.note({ engineReady: true, ownsProducts: true }),
  ];

  it('carries no dash, no exclamation mark and no lowercase Scenri', () => {
    for (const text of copy) expect(text).not.toMatch(new RegExp(`[${DASHES}!]|\\bscenri\\b`));
  });

  it('teaches the product, never the chrome', () => {
    for (const text of copy) {
      expect(text).not.toMatch(/\b(unique|magic|credits?|compare|heatmap)\b|generate anything/i);
      expect(text).not.toMatch(/\b(press|tap|click|try one now|say what you want)\b|\+/i);
    }
  });

  it('keeps every sentence short: one or two to a step', () => {
    for (const text of copy) expect(text.split(/[.?]\s/).filter(Boolean).length).toBeLessThanOrEqual(2);
  });

  it('never repeats the title of the surface a note sits in', () => {
    for (const text of [COPY.product, COPY.scene, COPY.presenterStart, COPY.presenterFace])
      expect(text).not.toMatch(/New product|New scene|Create presenter/);
  });
});
