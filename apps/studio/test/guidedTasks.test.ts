import { describe, it, expect } from 'vitest';
import type { GuideTaskNode, GuideView, ShowcaseEntry } from '../src/apiTypes.js';
import type { ComposerFacts } from '../src/guideFacts.js';
import { SPEC_ORDER } from '../src/create/presenter/presenterQuestions.js';
import {
  COPY,
  WELCOME,
  assetStep,
  canWelcome,
  firstShotStep,
  firstSteps,
  madeOne,
  nextStep,
  mergeTaskNodes,
  presenterStep,
  REVIEWABLE,
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
  others: 0,
  words: false,
  canGo: false,
  busy: false,
  pickerOpen: false,
  refining: false,
  engine: 'ready',
  settings: 'pills',
  settled: { shape: false, count: false, quality: false },
  offered: { product: true, presenter: true, scene: true },
  ...over,
});
const settledAll = { shape: true, count: true, quality: true };
/** A brief with one of each ingredient a first shot asks for. */
const all = { products: 1, presenters: 1, scene: true };
const noScenes = { product: true, presenter: true, scene: false };
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
  const step = (c: ComposerFacts | null, nodes: GuideTaskNode[] = [], here = true, confirmed: string[] = []) =>
    firstShotStep({ here, composer: c, nodes, confirmed })?.id ?? null;

  it('says nothing away from Create, or before its composer has spoken', () => {
    expect(step(composer(), [], false)).toBeNull();
    expect(step(null)).toBeNull();
  });

  it('walks every control in order: add, pick one of each, direction, shape, number, size, generate', () => {
    expect(step(composer())).toBe('add');
    expect(step(composer({ pickerOpen: true }))).toBe('pick');
    expect(step(composer({ pickerOpen: true, products: 1 }))).toBe('pick');
    expect(step(composer({ pickerOpen: true, products: 1, presenters: 1 }))).toBe('pick');
    expect(step(composer({ pickerOpen: true, ...all }))).toBe('picked-all');
    expect(step(composer(all))).toBe('direct');
    const worded = { ...all, words: true, canGo: true };
    expect(step(composer(worded))).toBe('direct');
    expect(step(composer(worded), [], true, ['direct'])).toBe('shape');
    expect(
      step(composer({ ...worded, settled: { shape: true, count: false, quality: false } }), [], true, ['direct']),
    ).toBe('count');
    expect(
      step(composer({ ...worded, settled: { shape: true, count: true, quality: false } }), [], true, ['direct']),
    ).toBe('quality');
    expect(step(composer({ ...worded, settled: settledAll }), [], true, ['direct'])).toBe('generate');
  });

  it('asks for a product, a presenter and a scene, ticking each as it comes in, whatever order they come in', () => {
    const pick = (over: Partial<ComposerFacts>) =>
      firstShotStep({ here: true, composer: composer({ pickerOpen: true, ...over }), nodes: [] });
    const ticks = (over: Partial<ComposerFacts>) => pick(over)?.checklist?.map((k) => `${k.label}:${k.done}`);
    expect(pick({})).toMatchObject({ title: 'Add a product, a presenter and a scene', body: COPY.needProduct.body });
    expect(ticks({})).toEqual(['Product:false', 'Presenter:false', 'Scene:false']);
    expect(pick({ products: 1 })).toMatchObject({
      title: 'Add a presenter and a scene',
      body: COPY.needPresenter.body,
    });
    expect(pick({ presenters: 1 })).toMatchObject({ title: 'Add a product and a scene', body: COPY.needProduct.body });
    expect(ticks({ presenters: 1 })).toEqual(['Product:false', 'Presenter:true', 'Scene:false']);
    expect(pick({ products: 1, presenters: 1 })).toMatchObject({ title: 'Add a scene', body: COPY.needScene.body });
    // a colour or an image is welcome, but it is none of the three
    expect(step(composer({ others: 1 }))).toBe('add');
    // an ingredient the library has none of is never asked for
    expect(step(composer({ pickerOpen: true, products: 1, presenters: 1, offered: noScenes }))).toBe('picked-all');
    expect(step(composer({ products: 1, presenters: 1, offered: noScenes }))).toBe('direct');
  });

  it('Continue waits for all three, then closes the picker', () => {
    const waiting = firstShotStep({ here: true, composer: composer({ pickerOpen: true, products: 1 }), nodes: [] });
    expect(waiting?.action).toEqual({ kind: 'close-picker', label: 'Continue', disabled: true });
    const ready = firstShotStep({ here: true, composer: composer({ pickerOpen: true, ...all }), nodes: [] });
    expect(ready?.action).toEqual({ kind: 'close-picker', label: 'Continue' });
    expect(ready?.checklist?.every((k) => k.done)).toBe(true);
  });

  it('the direction is done when it is said to be, never at the first word', () => {
    const direct = firstShotStep({ here: true, composer: composer({ ...all, words: true }), nodes: [] });
    expect(direct?.action).toEqual({ kind: 'confirm', label: 'Continue' });
    expect(firstShotStep({ here: true, composer: composer(all), nodes: [] })?.action).toBeUndefined();
    // emptying the brief asks for the direction again, whatever was said before
    expect(step(composer(all), [], true, ['direct'])).toBe('direct');
  });

  it('a narrow composer offers the three settings as one step behind one control', () => {
    const worded = { ...all, words: true };
    const g = firstShotStep({
      here: true,
      composer: composer({ ...worded, settings: 'sheet' }),
      nodes: [],
      confirmed: ['direct'],
    });
    expect(g).toMatchObject({ id: 'settings', target: '[data-guide="compose.settings"]' });
    expect(g?.optional).toEqual(['.sc-morepop', '.sc-shotsheet']);
    expect(step(composer({ ...worded, settings: 'more', settled: settledAll }), [], true, ['direct'])).toBe('generate');
  });

  it('the composer stays in view whole; the card points at the one control asked for, and only it can be used', () => {
    const add = firstShotStep({ here: true, composer: composer(), nodes: [] });
    expect(add).toMatchObject({
      target: '[data-guide="compose.add"]',
      surfaces: ['[data-guide="compose"]'],
      live: ['[data-guide="compose.add"]'],
    });
    const shape = firstShotStep({
      here: true,
      composer: composer({ ...all, words: true }),
      nodes: [],
      confirmed: ['direct'],
    });
    expect(shape).toMatchObject({
      target: '[data-guide="compose.shape"]',
      surfaces: ['[data-guide="compose"]'],
      live: ['[data-guide="compose.shape"]'],
      optional: ['.sc-setpop'],
    });
  });

  it('closing the picker short goes back to add, saying what is still missing; words alone still start from ingredients', () => {
    expect(step(composer({ pickerOpen: false }))).toBe('add');
    expect(step(composer({ words: true, canGo: true }))).toBe('add');
    const more = firstShotStep({ here: true, composer: composer({ products: 1 }), nodes: [] });
    expect(more).toMatchObject({ id: 'add', title: 'Now add a presenter and a scene' });
    expect(more?.checklist?.map((k) => k.done)).toEqual([true, false, false]);
  });

  it('removing every ingredient goes back to add', () => {
    expect(step(composer({ products: 0, presenters: 0, words: true }))).toBe('add');
  });

  it('in the picker the card points at the whole picker, beside it, with the picker and its toggle live', () => {
    const pick = firstShotStep({ here: true, composer: composer({ pickerOpen: true }), nodes: [] });
    expect(pick).toMatchObject({ voice: 'coach', target: '[data-guide="compose"] .sc-attachpanel', beside: true });
    expect(pick?.live).toEqual(['[data-guide="compose"] .sc-attachpanel', '[data-guide="compose.add"]']);
  });

  it('Back only ever reviews steps that point at a control', () => {
    expect([...REVIEWABLE].sort()).toEqual([
      'add',
      'count',
      'direct',
      'engine',
      'generate',
      'quality',
      'settings',
      'shape',
    ]);
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
    const wait = firstShotStep({ here: true, composer: composer(), nodes: [node('n1', 'running')] });
    // the wait is a card on its own tile, and its X only puts it away: the first shot is still coming
    expect(wait).toMatchObject({ voice: 'card', target: '.sc-feed .sc-cell[data-fb-node="n1"]', snooze: true });
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
    expect(step(composer(all), [node('n1', 'error')])).toBe('direct');
  });

  it('a refine armed in the composer is not the first shot', () => {
    expect(step(composer({ refining: true, products: 1 }))).toBeNull();
  });
});

describe('the later tasks', () => {
  it("refine: a coach on the open shot's composer, quiet while it draws, then a card on the new version", () => {
    expect(refineStep({ here: false, nodes: [] })).toBeNull();
    expect(refineStep({ here: true, nodes: [] })).toMatchObject({
      voice: 'coach',
      container: '.sc-ovl',
      target: '.sc-ovl .sc-promptcard',
      title: COPY.refineAsk.title,
    });
    expect(refineStep({ here: true, nodes: [{ ...node('e1', 'running'), kind: 'edit' }] })?.voice).toBe('quiet');
    const done = refineStep({ here: true, nodes: [{ ...node('e1', 'done', 1), kind: 'edit' }] });
    expect(done).toMatchObject({ voice: 'card', done: true, title: COPY.refineResult.title });
  });

  it('presenter: the conversation is guided at every decision that shapes the person, and quiet through the rest', () => {
    expect(presenterStep(null)).toBeNull();
    const loud = new Map<string, string>();
    const ids = [
      ...SPEC_ORDER,
      'agree',
      'noengine',
      'unsure',
      'retry',
      'name',
      'revision',
      'view-revision',
      'identity',
      'extras',
      'save',
      'blind',
      null,
    ];
    for (const open of ids) {
      const g = presenterStep({ open });
      if (g?.voice !== 'quiet') loud.set(String(open), String(g?.id));
    }
    expect(Object.fromEntries(loud)).toEqual({
      source: 'intro',
      photos: 'photos',
      'look-who': 'look',
      describe: 'describe',
      traits: 'traits',
      agree: 'draw',
      name: 'name',
      revision: 'face',
      'view-revision': 'body',
      identity: 'face',
      extras: 'extras',
      save: 'save',
      blind: 'save',
    });
    // a choice points at the question's own answers, and only they are live; words point at the composer that takes them
    expect(presenterStep({ open: 'traits' })).toMatchObject({
      voice: 'coach',
      container: '.sc-pstudio',
      target: '.sc-pstudio [data-turn="q:traits"] .sc-convo-q',
      live: ['.sc-pstudio [data-turn="q:traits"]'],
    });
    // a decision about a picture keeps the picture in view and usable: its versions are part of deciding
    expect(presenterStep({ open: 'identity' })).toMatchObject({
      surfaces: ['.sc-pstudio [data-turn="q:identity"]', '.sc-pstudio-well'],
      live: ['.sc-pstudio [data-turn="q:identity"]', '.sc-pstudio-well'],
    });
    expect(presenterStep({ open: 'name' })).toMatchObject({
      target: '.sc-pstudio-foot .sc-convo-card',
      live: ['.sc-pstudio-foot .sc-convo-card'],
    });
  });

  it('product and scene: their dialog is held, nothing when it is closed', () => {
    expect(assetStep('product', false)).toBeNull();
    expect(assetStep('product', true)).toMatchObject({
      voice: 'coach',
      container: '.sc-newdlg-layer',
      target: '.sc-newdlg',
      title: COPY.product.title,
    });
    expect(assetStep('scene', true)?.body).toBe(COPY.scene.body);
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

  it('a task left on another surface gives way; the first shot and the same task never do', () => {
    const active = (task: 'product' | 'first-shot' | 'scene') => ({
      task,
      brandId: 'b',
      since: 'x',
      baseline: { products: 0, presenters: 0, scenes: 0 },
    });
    expect(startsHere('scene', s({ active: active('product') }))).toBe(true);
    expect(startsHere('scene', s({ active: active('first-shot') }))).toBe(false);
    expect(startsHere('scene', s({ active: active('scene') }))).toBe(false);
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

  it('waits for the record, shows from the start, and stays away when hidden', () => {
    expect(firstSteps(view({ loaded: false }))).toBeNull();
    expect(firstSteps(view({ hidden: true }))).toBeNull();
    expect(firstSteps(view({ welcome: null }))).not.toBeNull();
  });

  it('lists the five tasks, ticked by what exists and dotted for the one in hand', () => {
    const rows = firstSteps(
      view({
        done: { shot: 'x', product: 'y' },
        active: { task: 'presenter', brandId: 'b', since: 'x', baseline: { products: 0, presenters: 0, scenes: 0 } },
      }),
    );
    expect(rows?.map((r) => [r.task, r.state, r.title, r.label])).toEqual([
      ['first-shot', 'done', 'Make your first shot', 'First shot'],
      ['refine', 'todo', 'Refine a shot', 'Refine'],
      ['product', 'done', 'Add your own product', 'Product'],
      ['presenter', 'active', 'Continue your presenter', 'Presenter'],
      ['scene', 'todo', 'Build a scene', 'Scene'],
    ]);
    // refining is said to start from a shot until there is one
    expect(firstSteps(view())?.[1].why).toBe('Starts from your first shot.');
  });

  it('the next step is the one in hand, else the first not done, else none', () => {
    const rows = firstSteps(view({ done: { shot: 'x' } })) ?? [];
    expect(nextStep(rows)?.task).toBe('refine');
    const inHand = firstSteps(
      view({
        done: { shot: 'x' },
        active: { task: 'scene', brandId: 'b', since: 'x', baseline: { products: 0, presenters: 0, scenes: 0 } },
      }),
    );
    expect(nextStep(inHand ?? [])?.task).toBe('scene');
    const all = firstSteps(
      view({ asked: true, done: { shot: 'a', refine: 'b', product: 'c', presenter: 'd', scene: 'e' } }),
    );
    expect(nextStep(all ?? [])).toBeNull();
  });

  it('leaves once everything is done, unless it was asked for from Help', () => {
    const all = { shot: 'a', refine: 'b', product: 'c', presenter: 'd', scene: 'e' };
    expect(firstSteps(view({ done: all }))).toBeNull();
    expect(firstSteps(view({ done: all, asked: true }))?.every((r) => r.state === 'done')).toBe(true);
    expect(firstSteps(view({ welcome: null, asked: true }))).not.toBeNull();
    expect(firstSteps(view({ done: all, asked: true, hidden: true }))).toBeNull();
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
    for (const c of [COPY.product, COPY.scene, COPY.presenterFace, COPY.presenterSave, COPY.presenterPhotos])
      expect(`${c.title} ${c.body}`).not.toMatch(/New product|New scene/);
  });
});
