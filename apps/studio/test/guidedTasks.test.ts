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
  wordPrint,
  refineStep,
  starterRecipe,
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
  wordPrint: '',
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

  const OFFERS = ['product', 'presenter', 'scene', 'words'] as const;
  const walk = (c: ComposerFacts, said: string[] = []) =>
    firstShotStep({ here: true, composer: c, nodes: [], confirmed: said, offers: OFFERS });

  it('builds the brief with them, a part at a time, then leaves one thing to press', () => {
    expect(walk(composer())?.id).toBe('product');
    expect(walk(composer({ products: 1 }))?.id).toBe('presenter');
    expect(walk(composer({ products: 1, presenters: 1 }))?.id).toBe('scene');
    expect(walk(composer(all))?.id).toBe('words');
    expect(walk(composer({ ...all, words: true }))?.id).toBe('words');
    expect(walk(composer({ ...all, words: true }), ['words'])?.id).toBe('settings');
    expect(walk(composer({ ...all, words: true }), ['words', 'settings'])?.id).toBe('generate');
  });

  it('every part is offered, never put in unasked, and their own pick answers the same question', () => {
    // each step offers ours; the ingredients so far are listed on the card
    expect(walk(composer())).toMatchObject({
      action: { kind: 'fill', label: 'Use ours' },
      title: COPY.wantProduct.title,
    });
    expect(walk(composer())?.checklist?.map((k) => k.done)).toEqual([false, false, false]);
    expect(walk(composer({ products: 1 }))).toMatchObject({ title: COPY.wantPresenter.title });
    expect(walk(composer({ products: 1, presenters: 1 }))).toMatchObject({ title: COPY.wantScene.title });
    // the words: ours to hand over, or theirs to finish saying
    expect(walk(composer(all))).toMatchObject({ action: { kind: 'fill', label: 'Write one for me' } });
    expect(walk(composer({ ...all, words: true }))).toMatchObject({ action: { kind: 'confirm', label: 'Next' } });
    // with nothing of ours to offer, the same steps simply ask
    const bare = firstShotStep({ here: true, composer: composer(), nodes: [], offers: [] });
    expect(bare?.id).toBe('product');
    expect(bare?.action).toBeUndefined();
  });

  it('Scenri makes the first shot itself only while the brief is the one it had in mind', () => {
    const said = ['words', 'settings'];
    const brief = composer({ ...all, words: true });
    expect(firstShotStep({ here: true, composer: brief, nodes: [], confirmed: said, staged: true })?.body).toBe(
      COPY.generateStaged.body,
    );
    expect(firstShotStep({ here: true, composer: brief, nodes: [], confirmed: said })?.body).toBe(COPY.generate.body);
    // their own brief is generated the real way, which is what needs an engine,
    // and they only hear about it once there is a brief to generate
    expect(
      firstShotStep({
        here: true,
        composer: composer({ ...all, words: true, engine: 'setup' }),
        nodes: [],
        confirmed: said,
      })?.id,
    ).toBe('engine');
    expect(firstShotStep({ here: true, composer: composer({ engine: 'setup' }), nodes: [], offers: OFFERS })?.id).toBe(
      'product',
    );
    expect(
      firstShotStep({
        here: true,
        composer: composer({ ...all, words: true, engine: 'setup' }),
        nodes: [],
        confirmed: said,
        staged: true,
      })?.id,
    ).toBe('generate');
  });

  it('while the picker is open it is the step, with the picker and its toggle live', () => {
    const open = walk(composer({ pickerOpen: true }));
    expect(open).toMatchObject({
      id: 'product',
      target: '[data-guide="compose"] .sc-attachpanel',
      beside: true,
      live: ['[data-guide="compose"] .sc-attachpanel', '[data-guide="compose.add"]'],
      action: { kind: 'fill', label: 'Use ours' },
    });
    // nothing left to add: Next is what closes it
    expect(walk(composer({ ...all, pickerOpen: true }))?.action).toEqual({ kind: 'close-picker', label: 'Next' });
  });

  it('the settings are set to suit the shot: the row on a wide composer, the one control on a narrow one', () => {
    const at = (settings: 'pills' | 'more' | 'sheet') => walk(composer({ ...all, words: true, settings }), ['words']);
    expect(at('pills')).toMatchObject({
      id: 'settings',
      target: '[data-guide="compose.settings-row"]',
      live: ['[data-guide="compose.shape"]', '[data-guide="compose.count"]', '[data-guide="compose.quality"]'],
      optional: ['.sc-setpop'],
    });
    expect(at('sheet')).toMatchObject({
      id: 'settings',
      target: '[data-guide="compose.settings"]',
      optional: ['.sc-morepop', '.sc-shotsheet'],
    });
  });

  it('the composer stays in view whole; the card points at the part being added', () => {
    expect(walk(composer())).toMatchObject({
      target: '[data-guide="compose.add"]',
      surfaces: ['[data-guide="compose"]'],
      live: ['[data-guide="compose.add"]'],
    });
    expect(walk(composer({ ...all, words: true }), ['words', 'settings'])).toMatchObject({
      target: '[data-guide="compose.send"]',
      surfaces: ['[data-guide="compose"]'],
      live: ['[data-guide="compose.send"]'],
    });
  });

  it('the same words, however they were spaced, are the same words', () => {
    expect(wordPrint(' In  the last of\nthe light ')).toBe(wordPrint('In the last of the light'));
    expect(wordPrint('a')).not.toBe(wordPrint('b'));
  });

  it('Back only ever reviews steps that point at a control', () => {
    expect([...REVIEWABLE].sort()).toEqual([
      'engine',
      'generate',
      'presenter',
      'product',
      'scene',
      'settings',
      'words',
    ]);
  });

  it('with no engine, the setup is what the last step points at', () => {
    const g = firstShotStep({
      here: true,
      composer: composer({ engine: 'setup', ...all, words: true }),
      nodes: [],
      confirmed: ['words', 'settings'],
    });
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
    expect(step(composer({ pickerOpen: true }), [node('n1', 'error')])).toBe('product');
    expect(step(composer(all), [node('n1', 'error')])).toBe('words');
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

describe('the recipe a first shot starts from', () => {
  const recipe = (id: string, over: Record<string, unknown> = {}) =>
    ({
      id,
      title: id,
      category: 'c',
      width: 1024,
      height: 1280,
      previewUrl: `/api/showcase-previews/${id}.jpg`,
      brief: {
        tokens: [
          { t: 'product', id: 'p' },
          { t: 'character', id: 'c' },
          { t: 'template', id: 's' },
          { t: 'text', v: 'in the last of the light' },
        ],
      },
      ...over,
    }) as unknown as ShowcaseEntry;

  it('takes the curated order: something to show, someone showing it, somewhere to be, and the words', () => {
    const half = recipe('half', { brief: { tokens: [{ t: 'product', id: 'p' }] } });
    const noPicture = recipe('nopic', { previewUrl: null, order: 1 });
    const complete = recipe('whole', { order: 9 });
    const later = recipe('later', { order: 40 });
    expect(starterRecipe([half, noPicture, later, complete])?.id).toBe('whole');
    // everyone new starts from the same one
    expect(starterRecipe([later, complete])?.id).toBe(starterRecipe([complete, later])?.id);
    expect(starterRecipe([half, noPicture])).toBeNull();
    expect(starterRecipe([])).toBeNull();
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
