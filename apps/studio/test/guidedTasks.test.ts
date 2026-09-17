import { describe, it, expect } from 'vitest';
import type { GuideTaskNode, GuideView, ShowcaseEntry } from '../src/apiTypes.js';
import type { ComposerFacts } from '../src/guideFacts.js';
import { SPEC_ORDER } from '../src/create/presenter/presenterQuestions.js';
import {
  COPY,
  WELCOME,
  canWelcome,
  firstShotMoment,
  firstSteps,
  madeOne,
  mergeTaskNodes,
  presenterMoment,
  refineMoment,
  sceneMoment,
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
  busy: false,
  pickerOpen: false,
  refining: false,
  engine: 'ready',
  ...over,
});
/** A brief with one of each ingredient a first shot asks for. */
const all = { products: 1, presenters: 1, scene: true };
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

describe('the first shot, one ask at a time', () => {
  const ask = (c: ComposerFacts | null, nodes: GuideTaskNode[] = [], here = true) =>
    firstShotMoment({ here, composer: c, nodes, begun: true });
  const idOf = (c: ComposerFacts | null, nodes: GuideTaskNode[] = [], here = true) => ask(c, nodes, here)?.id ?? null;

  it('says nothing away from Create, or before its composer has spoken', () => {
    expect(idOf(composer(), [], false)).toBeNull();
    expect(idOf(null)).toBeNull();
  });

  it('greets an empty start once, then never again', () => {
    const fresh = firstShotMoment({ here: true, composer: composer(), nodes: [] });
    // the greeting is not one of the four: it carries no count
    expect(fresh).toMatchObject({ id: 'intro', start: true });
    expect(fresh?.at).toBeUndefined();
    // someone already under way is past being told what this place is
    expect(firstShotMoment({ here: true, composer: composer({ products: 1 }), nodes: [] })?.id).toBe('presenter');
    expect(firstShotMoment({ here: true, composer: composer({ words: true }), nodes: [] })?.id).toBe('product');
  });

  it('asks for what, who, where, then the words and the making as one act', () => {
    expect(idOf(composer())).toBe('product');
    expect(idOf(composer({ products: 1 }))).toBe('presenter');
    expect(idOf(composer({ products: 1, presenters: 1 }))).toBe('scene');
    expect(idOf(composer(all))).toBe('make');
    expect(idOf(composer({ ...all, words: true }))).toBe('make');
    // and it says where it is: four asks, counted
    expect(ask(composer())?.at).toBe(1);
    expect(ask(composer(all))?.of).toBe(4);
  });

  it('never advances on a click: taking an ingredient back asks for it again', () => {
    expect(idOf(composer({ products: 1, presenters: 1, scene: true, words: true }))).toBe('make');
    expect(idOf(composer({ products: 0, presenters: 1, scene: true, words: true }))).toBe('product');
    expect(idOf(composer({ ...all, words: false }))).toBe('make');
  });

  it('has no button to press: the product answers, not the card', () => {
    for (const c of [composer(), composer({ products: 1 }), composer(all), composer({ ...all, words: true })]) {
      const m = ask(c);
      expect(m).not.toHaveProperty('action');
      expect(m?.voice).toBe('ask');
    }
  });

  it('follows into the picker with the same words, and leaves it usable', () => {
    const shut = ask(composer());
    expect(shut).toMatchObject({ id: 'product', point: '[data-guide="compose.add"]', ...COPY.product });
    const open = ask(composer({ pickerOpen: true }));
    expect(open).toMatchObject({
      id: 'product',
      point: '[data-guide="compose"] .sc-attachpanel',
      live: ['[data-guide="compose"] .sc-attachpanel .sc-ap-body'],
      beside: true,
      ...COPY.product,
    });
    // and it keeps following as the ask moves on
    expect(ask(composer({ pickerOpen: true, products: 1 }))?.id).toBe('presenter');
  });

  it('the last moment is both halves of one act: the words and the making', () => {
    expect(ask(composer(all))).toMatchObject({
      id: 'make',
      point: '[data-guide="compose.send"]',
      live: ['[data-guide="compose"] .sc-brief-line', '[data-guide="compose.send"]'],
      title: COPY.make.title,
    });
  });

  it('with nothing that can draw, the setup is the only ask', () => {
    expect(idOf(composer({ engine: 'setup' }))).toBe('engine');
    expect(idOf(composer({ ...all, words: true, engine: 'settings' }))).toBe('engine');
    expect(ask(composer({ engine: 'setup' }))).toMatchObject({ point: '[data-guide="compose.engine"]', voice: 'ask' });
  });

  it('a send in flight is quiet, and a running take is a note on its own tile', () => {
    expect(idOf(composer({ busy: true, products: 1 }))).toBe('sending');
    expect(ask(composer(), [node('n1', 'running')])).toMatchObject({
      id: 'waiting',
      voice: 'note',
      point: '.sc-feed .sc-cell[data-fb-node="n1"]',
    });
    expect(idOf(composer({ engine: 'setup' }), [node('n1', 'running')])).toBe('waiting');
  });

  it('a finished picture ends it on its own tile, even beside a failed sibling', () => {
    const m = ask(composer(), [node('n2', 'error'), node('n1', 'done', 1)]);
    expect(m).toMatchObject({ id: 'result', voice: 'note', point: '.sc-feed .sc-cell[data-fb-node="n1"]', done: true });
  });

  it('done with no picture is a failure, never a shot', () => {
    expect(idOf(composer(), [node('n1', 'done', 0)])).toBe('failed');
  });

  it('every take failed: the note waits on the newest tile until the brief is being built again', () => {
    const m = ask(composer(), [node('n2', 'cancelled'), node('n1', 'error')]);
    expect(m?.id).toBe('failed');
    expect(m?.point).toContain('n2');
    expect(idOf(composer({ pickerOpen: true }), [node('n1', 'error')])).toBe('product');
    expect(idOf(composer(all), [node('n1', 'error')])).toBe('make');
  });

  it('a refine armed in the composer is not the first shot', () => {
    expect(idOf(composer({ refining: true, products: 1 }))).toBeNull();
  });
});

describe('the later tasks', () => {
  it("refine: ask on the open shot's composer, quiet while it draws, then a note on the new version", () => {
    expect(refineMoment({ here: false, nodes: [] })).toBeNull();
    expect(refineMoment({ here: true, nodes: [] })).toMatchObject({
      voice: 'ask',
      shell: '.sc-ovl',
      point: '.sc-ovl .sc-promptcard',
      title: COPY.refineAsk.title,
    });
    expect(refineMoment({ here: true, nodes: [{ ...node('e1', 'running'), kind: 'edit' }] })?.voice).toBe('quiet');
    expect(refineMoment({ here: true, nodes: [{ ...node('e1', 'done', 1), kind: 'edit' }] })).toMatchObject({
      voice: 'note',
      done: true,
      title: COPY.refineResult.title,
    });
  });

  it('presenter: three decisions get a word, and every question the studio asks itself is quiet', () => {
    expect(presenterMoment(null)).toBeNull();
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
      const m = presenterMoment({ open });
      if (m?.voice !== 'quiet') loud.set(String(open), String(m?.id));
    }
    expect(Object.fromEntries(loud)).toEqual({
      source: 'start',
      // a wall is not a question the studio can explain away
      noengine: 'engine',
      identity: 'face',
      revision: 'face',
      save: 'save',
      blind: 'save',
    });
    expect(presenterMoment({ open: 'source' })).toMatchObject({
      voice: 'ask',
      shell: '.sc-pstudio',
      point: '.sc-pstudio [data-turn="q:source"] .sc-convo-q',
      live: ['.sc-pstudio [data-turn="q:source"]'],
    });
    // deciding a face keeps the picture usable: its versions are part of deciding
    expect(presenterMoment({ open: 'identity' })?.live).toEqual([
      '.sc-pstudio [data-turn="q:identity"]',
      '.sc-pstudio-well',
    ]);
  });

  it('scene: its dialog is held, nothing when it is closed', () => {
    expect(sceneMoment(false)).toBeNull();
    expect(sceneMoment(true)).toMatchObject({
      voice: 'ask',
      shell: '.sc-newdlg-layer',
      point: '.sc-newdlg',
      title: COPY.sceneMake.title,
    });
  });

  it('a task that makes something ends when the brand holds one more than when it began', () => {
    const view = (task: 'presenter' | 'scene' | 'refine') =>
      ({
        active: { task, brandId: 'b1', since: 'x', baseline: { products: 2, presenters: 0, scenes: 1 } },
        counts: null,
      }) as Pick<GuideView, 'active' | 'counts'>;
    expect(madeOne(view('presenter'), { products: 2, presenters: 1, scenes: 1 })).toBe(true);
    expect(madeOne(view('presenter'), { products: 9, presenters: 0, scenes: 9 })).toBe(false);
    expect(madeOne(view('scene'), { products: 9, presenters: 9, scenes: 2 })).toBe(true);
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
    for (const c of [COPY.product, COPY.sceneMake, COPY.presenterFace, COPY.presenterSave, COPY.intro])
      expect(`${c.title} ${c.body}`).not.toMatch(/New product|New scene/);
  });
});
