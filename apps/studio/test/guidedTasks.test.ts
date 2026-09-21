import { describe, it, expect } from 'vitest';
import { UNCOUNTED, countedMoments, stepOfMoment } from '../src/lessons.js';
import type { GuideTaskNode, GuideView, ShowcaseEntry } from '../src/apiTypes.js';
import type { ComposerFacts } from '../src/guideFacts.js';
import { SPEC_ORDER } from '../src/create/presenter/presenterQuestions.js';
import {
  COPY,
  WELCOME,
  canWelcome,
  chipToTakeBack,
  coachCanBack,
  firstShotMoment,
  madeOne,
  mergeTaskNodes,
  presenterMoment,
  productMoment,
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

  it('begun away from Create, the first step is the way there', () => {
    const go = firstShotMoment({ here: false, heading: true, composer: null, nodes: [] });
    // Create in the places, lit on a page left in plain view
    expect(go).toMatchObject({ id: 'go', voice: 'ask', point: '[data-guide="nav.create"]', soft: true });
    expect(go?.title).toBe(COPY.go.title);
    // away from Create without having just begun it, nothing follows them
    expect(firstShotMoment({ here: false, composer: composer(), nodes: [] })).toBeNull();
    // where a moment sits is the lesson's to say, not the rule's: one list
    // feeds the card and Learn (lessons.ts), so a rule counts nothing itself
    expect(go).not.toHaveProperty('at');
    expect(stepOfMoment('first-shot', 'go')).toEqual({ at: 1, of: 6 });
    expect(stepOfMoment('first-shot', 'make')).toEqual({ at: 5, of: 6 });
    expect(stepOfMoment('first-shot', 'intro')).toBeNull();
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
    // and where each sits is the lesson's own numbering
    expect(stepOfMoment('first-shot', 'product')).toEqual({ at: 2, of: 6 });
    expect(stepOfMoment('first-shot', 'result')).toEqual({ at: 6, of: 6 });
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
    // the add control is the one thing: the brief waits for the last ask
    expect(shut?.also).toBeUndefined();
    expect(shut?.live).toBeUndefined();
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
  const refFacts = (over: Partial<Parameters<typeof refineMoment>[0]> = {}): Parameters<typeof refineMoment>[0] => ({
    here: true,
    open: false,
    armed: false,
    nodes: [],
    ...over,
  });

  it('refine: begun away from Create, the first step is the way there', () => {
    expect(refineMoment(refFacts({ here: false, heading: true }))).toMatchObject({
      id: 'go',
      voice: 'ask',
      point: '[data-guide="nav.create"]',
      soft: true,
      title: COPY.refineGo.title,
    });
  });

  it('refine: off the surface entirely, nothing shows', () => {
    expect(refineMoment(refFacts({ here: false }))).toBeNull();
  });

  it('refine: neither a shot open nor the card armed asks which one to change', () => {
    expect(refineMoment(refFacts())).toMatchObject({
      id: 'choose',
      voice: 'ask',
      point: '.sc-feed',
      live: ['.sc-feed'],
      title: COPY.refineChoose.title,
    });
  });

  it('refine: opening the shot asks on its own composer, quiet while it draws, then a note on the history', () => {
    expect(refineMoment(refFacts({ open: true }))).toMatchObject({
      voice: 'ask',
      shell: '.sc-ovl',
      point: '.sc-ovl .sc-promptcard',
      // saying what to change means looking at the picture: it stays in sight
      also: ['.sc-ovl .sc-stage-img'],
      title: COPY.refineAsk.title,
    });
    expect(refineMoment(refFacts({ open: true, nodes: [{ ...node('e1', 'running'), kind: 'edit' }] }))?.voice).toBe(
      'quiet',
    );
    // the change landed in the history, so that is what the note points at
    expect(refineMoment(refFacts({ open: true, nodes: [{ ...node('e1', 'done', 1), kind: 'edit' }] }))).toMatchObject({
      voice: 'note',
      point: '.sc-ovl .sc-trail',
      done: true,
      title: COPY.refineResult.title,
    });
  });

  it("refine: the card's own Refine arms the docked composer, asking there instead", () => {
    expect(refineMoment(refFacts({ armed: true }))).toMatchObject({
      id: 'ask',
      voice: 'ask',
      point: '[data-guide="compose"] .sc-promptcard',
      live: ['[data-guide="compose"] .sc-promptcard'],
      title: COPY.refineAsk.title,
    });
    // and the same landings, pointed at the tile rather than the overlay
    expect(refineMoment(refFacts({ armed: true, nodes: [{ ...node('e1', 'done', 1), kind: 'edit' }] }))).toMatchObject({
      id: 'refined',
      voice: 'note',
      point: '.sc-feed .sc-cell[data-fb-node="e1"]',
      done: true,
    });
  });

  it('refine: a failed change is said on the history, or the tile, until a composer is there to ask again', () => {
    const dud = [{ ...node('e1', 'error'), kind: 'edit' }];
    expect(refineMoment(refFacts({ open: true, nodes: dud, asking: false }))).toMatchObject({
      id: 'refine-failed',
      voice: 'note',
      point: '.sc-ovl .sc-trail',
      title: COPY.refineFailed.title,
    });
    expect(refineMoment(refFacts({ open: true, nodes: dud, asking: true }))?.id).toBe('ask');
    expect(refineMoment(refFacts({ armed: true, nodes: dud, asking: false }))).toMatchObject({
      id: 'refine-failed',
      point: '.sc-feed .sc-cell[data-fb-node="e1"]',
    });
  });

  it('presenter: three decisions get a word, and every question the studio asks itself is quiet', () => {
    expect(presenterMoment({ studio: null })).toBeNull();
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
      const m = presenterMoment({ studio: { open } });
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
    expect(presenterMoment({ studio: { open: 'source' } })).toMatchObject({
      voice: 'ask',
      shell: '.sc-pstudio',
      point: '.sc-pstudio [data-turn="q:source"] .sc-convo-ask',
      live: ['.sc-pstudio [data-turn="q:source"]'],
      // a sentence typed in the studio's own line is the description
      also: ['.sc-pstudio .sc-convo-card'],
    });
    // deciding a face keeps the picture and the sentence usable, but waits for
    // neither: a phone draws no stage, and the question alone is the ask
    const face = presenterMoment({ studio: { open: 'identity' } });
    expect(face?.live).toEqual(['.sc-pstudio [data-turn="q:identity"]']);
    expect(face?.also).toEqual(['.sc-pstudio-well', '.sc-pstudio .sc-convo-card']);
    // the face as the conversation shows it, the turn just above the question, stays in sight
    expect(face?.lit).toEqual(['.sc-pstudio [data-turn]:has(+ [data-turn="q:identity"])']);
    // a wall is only the wall: nothing to type past it
    expect(presenterMoment({ studio: { open: 'noengine' } })?.also).toEqual([]);
  });

  it('presenter: the way there, then start one, then the studio', () => {
    expect(presenterMoment({ heading: true, studio: null })).toMatchObject({
      id: 'go',
      point: '[data-guide="nav.presenters"]',
      soft: true,
      title: COPY.presenterGo.title,
    });
    expect(presenterMoment({ onPage: true, studio: null })).toMatchObject({
      id: 'new',
      point: '[data-guide="library.new"]',
      title: COPY.presenterNew.title,
    });
    // the studio wins over the library page underneath it
    expect(presenterMoment({ onPage: true, studio: { open: 'source' } })?.id).toBe('start');
  });

  it('scene: the way there, then start one, then the dialog', () => {
    expect(sceneMoment({ dialogOpen: false })).toBeNull();
    expect(sceneMoment({ heading: true, dialogOpen: false })).toMatchObject({
      id: 'go',
      point: '[data-guide="nav.scenes"]',
      title: COPY.sceneGo.title,
    });
    expect(sceneMoment({ onPage: true, dialogOpen: false })).toMatchObject({
      id: 'new',
      point: '[data-guide="library.new"]',
      title: COPY.sceneNew.title,
    });
    expect(sceneMoment({ dialogOpen: true })).toMatchObject({
      voice: 'ask',
      shell: '.sc-newdlg-layer',
      point: '.sc-newdlg',
      title: COPY.sceneMake.title,
    });
    expect(COPY.sceneMake.body).toMatch(/Name it/);
  });

  it('product: the way there, then start one, then the dialog', () => {
    expect(productMoment({ dialogOpen: false })).toBeNull();
    expect(productMoment({ heading: true, dialogOpen: false })).toMatchObject({
      id: 'go',
      point: '[data-guide="nav.products"]',
      title: COPY.productGo.title,
    });
    expect(productMoment({ onPage: true, dialogOpen: false })).toMatchObject({
      id: 'new',
      point: '[data-guide="library.new"]',
      title: COPY.productNew.title,
    });
    expect(productMoment({ dialogOpen: true })).toMatchObject({
      id: 'product',
      voice: 'ask',
      shell: '.sc-newdlg-layer',
      point: '.sc-newdlg',
      title: COPY.productMake.title,
    });
  });

  it('a task that makes something ends when the brand holds one more than when it began', () => {
    const view = (task: 'presenter' | 'scene' | 'product' | 'refine') =>
      ({
        active: { task, brandId: 'b1', since: 'x', baseline: { products: 2, presenters: 0, scenes: 1 } },
        counts: null,
      }) as Pick<GuideView, 'active' | 'counts'>;
    expect(madeOne(view('presenter'), { products: 2, presenters: 1, scenes: 1 })).toBe(true);
    expect(madeOne(view('presenter'), { products: 9, presenters: 0, scenes: 9 })).toBe(false);
    expect(madeOne(view('scene'), { products: 9, presenters: 9, scenes: 2 })).toBe(true);
    expect(madeOne(view('scene'), { products: 9, presenters: 9, scenes: 1 })).toBe(false);
    expect(madeOne(view('product'), { products: 3, presenters: 0, scenes: 1 })).toBe(true);
    expect(madeOne(view('product'), { products: 2, presenters: 9, scenes: 9 })).toBe(false);
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

describe('hub and tutor stay one list', () => {
  it('every moment a rule can emit is a milestone, or explicitly uncounted', () => {
    const emitted = new Map<string, Set<string>>();
    const note = (task: string, id: string | undefined) => {
      if (!id) return;
      const set = emitted.get(task) ?? new Set();
      set.add(id);
      emitted.set(task, set);
    };
    note('first-shot', firstShotMoment({ here: false, heading: true, composer: null, nodes: [] })?.id);
    note('first-shot', firstShotMoment({ here: true, composer: composer(), nodes: [], begun: false })?.id);
    note('first-shot', firstShotMoment({ here: true, composer: composer(), nodes: [], begun: true })?.id);
    note(
      'first-shot',
      firstShotMoment({ here: true, composer: composer({ products: 1 }), nodes: [], begun: true })?.id,
    );
    note(
      'first-shot',
      firstShotMoment({ here: true, composer: composer({ products: 1, presenters: 1 }), nodes: [], begun: true })?.id,
    );
    note(
      'first-shot',
      firstShotMoment({
        here: true,
        composer: composer({ products: 1, presenters: 1, scene: true }),
        nodes: [],
        begun: true,
      })?.id,
    );
    note(
      'first-shot',
      firstShotMoment({ here: true, composer: composer({ engine: 'setup' }), nodes: [], begun: true })?.id,
    );
    note('first-shot', firstShotMoment({ here: true, composer: composer({ busy: true }), nodes: [], begun: true })?.id);
    note('first-shot', firstShotMoment({ here: true, composer: composer(), nodes: [node('n', 'running')] })?.id);
    note('first-shot', firstShotMoment({ here: true, composer: composer(), nodes: [node('n', 'error')] })?.id);
    note('first-shot', firstShotMoment({ here: true, composer: composer(), nodes: [node('n', 'done', 1)] })?.id);
    note('refine', refineMoment({ here: false, heading: true, open: false, armed: false, nodes: [] })?.id);
    note('refine', refineMoment({ here: true, open: false, armed: false, nodes: [] })?.id);
    note('refine', refineMoment({ here: true, open: true, armed: false, nodes: [] })?.id);
    note('refine', refineMoment({ here: true, open: false, armed: true, nodes: [] })?.id);
    note(
      'refine',
      refineMoment({ here: true, open: true, armed: false, nodes: [{ ...node('e', 'running'), kind: 'edit' }] })?.id,
    );
    note(
      'refine',
      refineMoment({ here: true, open: true, armed: false, nodes: [{ ...node('e', 'done', 1), kind: 'edit' }] })?.id,
    );
    note(
      'refine',
      refineMoment({
        here: true,
        open: true,
        armed: false,
        nodes: [{ ...node('e', 'error'), kind: 'edit' }],
        asking: false,
      })?.id,
    );
    note('product', productMoment({ heading: true, dialogOpen: false })?.id);
    note('product', productMoment({ onPage: true, dialogOpen: false })?.id);
    note('product', productMoment({ dialogOpen: true })?.id);
    note('scene', sceneMoment({ heading: true, dialogOpen: false })?.id);
    note('scene', sceneMoment({ onPage: true, dialogOpen: false })?.id);
    note('scene', sceneMoment({ dialogOpen: true })?.id);
    note('presenter', presenterMoment({ heading: true, studio: null })?.id);
    note('presenter', presenterMoment({ onPage: true, studio: null })?.id);
    note('presenter', presenterMoment({ studio: { open: 'source' } })?.id);
    note('presenter', presenterMoment({ studio: { open: 'identity' } })?.id);
    note('presenter', presenterMoment({ studio: { open: 'save' } })?.id);
    note('presenter', presenterMoment({ studio: { open: 'noengine' } })?.id);
    note('presenter', presenterMoment({ studio: { open: 'look-who' } })?.id);
    for (const [task, ids] of emitted) {
      const counted = new Set(countedMoments(task as never));
      const free = new Set<string>(UNCOUNTED);
      for (const id of ids) expect(counted.has(id) || free.has(id), `${task}: ${id}`).toBe(true);
    }
  });

  it('refine names both ways into the same ask', () => {
    expect(COPY.refineChoose.body).toMatch(/Open one/);
    expect(COPY.refineChoose.body).toMatch(/Refine/);
  });
});

describe('Back, on every counted step after the first', () => {
  it('takes the chip the last ask put in, and reuse never takes a presenter', () => {
    expect(chipToTakeBack('first-shot', 'presenter')).toBe('product');
    expect(chipToTakeBack('first-shot', 'scene')).toBe('presenter');
    expect(chipToTakeBack('first-shot', 'make')).toBe('scene');
    expect(chipToTakeBack('reuse', 'scene')).toBe('product');
    expect(chipToTakeBack('reuse', 'make')).toBe('scene');
    expect(chipToTakeBack('reuse', 'product')).toBeNull();
    expect(chipToTakeBack('scene', 'scene')).toBeNull();
  });

  it('is there once something can be undone, and not on the first step', () => {
    expect(coachCanBack('first-shot', 'go', false)).toBe(false);
    expect(coachCanBack('first-shot', 'product', false)).toBe(false);
    expect(coachCanBack('first-shot', 'product', true)).toBe(true);
    expect(coachCanBack('first-shot', 'presenter', false)).toBe(true);
    expect(coachCanBack('reuse', 'scene', false)).toBe(true);
    expect(coachCanBack('reuse', 'make', false)).toBe(true);
    expect(coachCanBack('presenter', 'go', false)).toBe(false);
    expect(coachCanBack('presenter', 'new', false)).toBe(false);
    expect(coachCanBack('presenter', 'new', true)).toBe(true);
    expect(coachCanBack('presenter', 'start', false)).toBe(true);
    expect(coachCanBack('presenter', 'face', false)).toBe(true);
    expect(coachCanBack('presenter', 'save', false)).toBe(true);
    expect(coachCanBack('product', 'product', false)).toBe(true);
    expect(coachCanBack('scene', 'scene', false)).toBe(true);
    expect(coachCanBack('refine', 'choose', true)).toBe(true);
    expect(coachCanBack('refine', 'ask', false)).toBe(true);
    expect(coachCanBack('refine', 'refined', false)).toBe(false);
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
      // "brief" is the code's name for the record and never reaches a person
      // (DESIGN.md, Writing). One note said "Build the brief again" for months.
      expect(text).not.toMatch(/\bbriefs?\b/i);
    }
  });

  it('keeps every sentence short: one or two to a step', () => {
    for (const text of copy) expect(text.split(/[.?]\s/).filter(Boolean).length).toBeLessThanOrEqual(2);
  });

  it('never repeats the title of the surface a note sits in', () => {
    for (const c of [
      COPY.product,
      COPY.sceneMake,
      COPY.productMake,
      COPY.presenterFace,
      COPY.presenterSave,
      COPY.intro,
    ])
      expect(`${c.title} ${c.body}`).not.toMatch(/New product|New scene/);
  });
});
