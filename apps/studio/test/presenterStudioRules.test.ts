import { describe, expect, it } from 'vitest';
import type { PresenterDraftSlot } from '../src/api.js';
import {
  doingLine,
  type Traits,
  VIEWS,
  NO_TRAITS,
  castSentence,
  hairName,
  composerState,
  coverageLine,
  currentView,
  emptySlot,
  nextToDraw,
  phaseOf,
  refineHint,
  refineTarget,
  resumable,
  saveBlocker,
  seedCategories,
  selectedView,
  stripItems,
  worthKeeping,
  type DraftLike,
  type StudioView,
  readsAsPerson,
} from '../src/create/presenter/presenterStudioRules.js';

const slot = (p: Partial<PresenterDraftSlot>): PresenterDraftSlot => ({ ...emptySlot(), ...p });
const approved = (hash: string, origin: 'generated' | 'photo' = 'generated') =>
  slot({ status: 'approved', hash, origin });
const candidate = (hash: string, extra: Partial<PresenterDraftSlot> = {}) =>
  slot({ status: 'candidate', hash, origin: 'generated', ...extra });

function draft(p: Partial<DraftLike> & { views?: Partial<Record<StudioView, PresenterDraftSlot>> } = {}): DraftLike {
  return {
    source: 'synthetic',
    name: '',
    direction: 'someone',
    sources: [],
    activeView: null,
    stage: 'idle',
    ...p,
    views: {
      portrait: emptySlot(),
      front: emptySlot(),
      'three-quarter': emptySlot(),
      back: emptySlot(),
      left: emptySlot(),
      right: emptySlot(),
      ...(p.views ?? {}),
    },
  };
}

/** Every view approved, the way the server saves them. */
const allSix = {
  portrait: approved('p'),
  front: approved('f'),
  'three-quarter': approved('q'),
  back: approved('b'),
  left: approved('l'),
  right: approved('r'),
};

describe('the order: face, full body, three-quarter, then back, left, right', () => {
  it('is six views, and the current one is the first not yet used', () => {
    expect(VIEWS).toEqual(['portrait', 'front', 'three-quarter', 'back', 'left', 'right']);
    expect(currentView(draft())).toBe('portrait');
    expect(currentView(draft({ views: { portrait: approved('p') } }))).toBe('front');
    expect(currentView(draft({ views: allSix }))).toBeNull();
  });
});

describe('phases', () => {
  it('is identity until the face is used, build until everything stands, then review', () => {
    expect(phaseOf(draft(), true)).toBe('identity');
    expect(phaseOf(draft({ views: { portrait: candidate('c') } }), true)).toBe('identity');
    expect(phaseOf(draft({ views: { portrait: approved('p') } }), true)).toBe('build');
    const done = draft({ views: allSix });
    expect(phaseOf(done, true)).toBe('review');
    // a revision pending on an approved view is not review
    expect(phaseOf({ ...done, views: { ...done.views, portrait: candidate('c', { prior: 'p' }) } }, true)).toBe(
      'build',
    );
    // drawing is never review
    expect(phaseOf({ ...done, activeView: 'portrait', stage: 'drawing' }, true)).toBe('build');
  });

  it('with no engine, a photos draft with its face is ready to save', () => {
    const d = draft({ source: 'photos', sources: ['a'], views: { portrait: approved('a', 'photo') } });
    expect(phaseOf(d, false)).toBe('review');
    expect(phaseOf(d, true)).toBe('build');
    expect(saveBlocker(d, 'Noor', false)).toBeNull();
    expect(saveBlocker(d, 'Noor', true)).toBe('Use the full body first');
  });
});

describe('what gets drawn next without a click', () => {
  it('draws the first empty view whose dependencies stand, and waits on a candidate or a failure', () => {
    expect(nextToDraw(draft())).toBe('portrait');
    expect(nextToDraw(draft({ views: { portrait: candidate('c') } }))).toBeNull();
    expect(nextToDraw(draft({ views: { portrait: approved('p') } }))).toBe('front');
    expect(nextToDraw(draft({ views: { portrait: approved('p'), front: slot({ error: 'timed out' }) } }))).toBeNull();
    expect(nextToDraw(draft({ activeView: 'front', stage: 'drawing', views: { portrait: approved('p') } }))).toBeNull();
  });

  it('draws a stale view again on its own: the change that staled it was already decided', () => {
    const d = draft({
      views: {
        portrait: approved('p2'),
        front: slot({ status: 'stale', hash: 'f', origin: 'generated' }),
        'three-quarter': slot({ status: 'stale', hash: 'q', origin: 'generated' }),
      },
    });
    expect(nextToDraw(d)).toBe('front');
    expect(nextToDraw({ ...d, views: { ...d.views, front: approved('f2') } })).toBe('three-quarter');
  });
});

describe('the strip is the progress', () => {
  it('marks what stands, what is on the stage, what is being drawn and what is still to come', () => {
    const d = draft({ activeView: 'front', stage: 'drawing', views: { portrait: approved('p') } });
    expect(selectedView(d, null)).toBe('front');
    expect(stripItems(d, 'front').map((i) => [i.view, i.state, i.drawing])).toEqual([
      ['portrait', 'approved', false],
      ['front', 'current', true],
      ['three-quarter', 'todo', false],
    ]);
    // the extras join the strip only once asked for
    expect(stripItems({ ...d, extras: true }, 'front')).toHaveLength(6);
    // a chosen view wins over the one being drawn
    expect(selectedView(d, 'portrait')).toBe('portrait');
    expect(stripItems(d, 'portrait')[0]).toMatchObject({ state: 'current', label: 'Face', photo: false });
    const photos = draft({ source: 'photos', views: { portrait: approved('a', 'photo') } });
    expect(stripItems(photos, 'front')[0]).toMatchObject({ state: 'approved', photo: true });
  });
});

describe('what a request is aimed at', () => {
  it('nudges the face before the lock, whatever view is on the stage', () => {
    const d = draft({ views: { portrait: candidate('c') } });
    expect(refineTarget('shorter hair', 'portrait', d)).toEqual({ view: 'portrait', scope: 'identity' });
    expect(refineTarget('turn to camera', 'front', d)).toEqual({ view: 'portrait', scope: 'identity' });
    expect(refineTarget('   ', 'portrait', d)).toEqual({ blocked: 'Say what should change.' });
    expect(refineTarget('older', 'portrait', draft())).toEqual({ blocked: 'Nothing to adjust yet.' });
  });

  it('after the lock, the face or an identity word changes the person; anything else changes the view', () => {
    const d = draft({ views: allSix });
    expect(refineTarget('a little shorter hair', 'front', d)).toEqual({ view: 'portrait', scope: 'identity' });
    expect(refineTarget('older, mid 40s', 'left', d)).toEqual({ view: 'portrait', scope: 'identity' });
    expect(refineTarget('less athletic', 'front', d)).toEqual({ view: 'portrait', scope: 'identity' });
    expect(refineTarget('warmer expression', 'portrait', d)).toEqual({ view: 'portrait', scope: 'identity' });
    expect(refineTarget('turn slightly more to camera', 'front', d)).toEqual({ view: 'front', scope: 'view' });
    expect(refineTarget('arms relaxed at the sides', 'left', d)).toEqual({
      view: 'left',
      scope: 'view',
    });
    expect(refineHint('portrait', d)).toContain('Changes the person');
    expect(refineHint('front', d)).toContain('this view only');
  });

  it('the composer chip names what Refine will redraw, and follows the sentence', () => {
    const pre = draft({ views: { portrait: candidate('c') } });
    expect(composerState('', 'portrait', pre).chip).toEqual({ view: 'portrait', label: 'Adjusting the face' });
    const d = draft({ views: allSix });
    expect(composerState('', 'front', d).chip).toEqual({ view: 'front', label: 'Refining the full body' });
    expect(composerState('turn to camera', 'left', d).chip).toEqual({ view: 'left', label: 'Refining the left view' });
    expect(composerState('shorter hair', 'front', d).chip).toEqual({ view: 'portrait', label: 'Changing the person' });
    expect(composerState('', 'portrait', d)).toMatchObject({
      chip: { view: 'portrait', label: 'Changing the person' },
      hint: expect.stringContaining('Changes the person'),
    });
    const photos = draft({
      source: 'photos',
      sources: ['a'],
      views: { portrait: approved('a', 'photo'), front: approved('f') },
    });
    expect(composerState('shorter hair', 'front', photos)).toEqual({
      chip: null,
      hint: 'Their photos define who they are. Change a drawn view instead.',
      tone: 'alert',
    });
    expect(composerState('', 'portrait', photos).chip).toBeNull();
  });

  it('never redraws a photograph', () => {
    const d = draft({
      source: 'photos',
      sources: ['a', 'b'],
      views: { portrait: approved('a', 'photo'), front: approved('b', 'photo'), left: approved('t') },
    });
    expect(refineTarget('shorter hair', 'left', d)).toEqual({
      blocked: 'Their photos define who they are. Change a drawn view instead.',
    });
    expect(refineTarget('turn to camera', 'front', d)).toEqual({
      blocked: 'Your photo stands as it is. Pick a drawn view to change.',
    });
    expect(refineTarget('turn to camera', 'left', d)).toEqual({ view: 'left', scope: 'view' });
    expect(refineHint('left', d)).toContain('Their photos define who they are');
  });
});

describe('leaving and saving', () => {
  it('a discard is worth a word only when something was drawn', () => {
    expect(worthKeeping(draft())).toBe(false);
    expect(worthKeeping(draft({ source: 'photos', sources: ['a'], views: { portrait: approved('a', 'photo') } }))).toBe(
      false,
    );
    expect(worthKeeping(draft({ views: { portrait: candidate('c') } }))).toBe(true);
  });

  it('a draft with a sentence, a photo or a picture is offered back', () => {
    expect(resumable(draft({ direction: '' }))).toBe(false);
    expect(resumable(draft({ direction: 'someone' }))).toBe(true);
    expect(resumable(draft({ direction: '', source: 'photos', sources: ['a'] }))).toBe(true);
  });

  it('the save blocker says the first thing in the way', () => {
    const d = draft({ views: { portrait: approved('p'), front: candidate('f') } });
    expect(saveBlocker(d, '')).toBe('Decide on the full body first');
    expect(saveBlocker(draft({ views: { portrait: approved('p') } }), '')).toBe('Use the full body first');
    // a view that decided itself and still holds the one it replaced is an offer, not a debt
    expect(
      saveBlocker(
        draft({
          views: {
            portrait: approved('p'),
            front: slot({ status: 'approved', hash: 'f2', prior: 'f', origin: 'generated' }),
            'three-quarter': approved('t'),
          },
        }),
        'Maren',
      ),
    ).toBeNull();
    expect(saveBlocker({ ...d, activeView: 'front', stage: 'drawing' }, '')).toBe('Still drawing');
    const revision = draft({
      views: { portrait: candidate('c', { prior: 'p' }), front: approved('f'), left: approved('t') },
    });
    expect(saveBlocker(revision, 'Maren')).toBe('Decide on the face first');
    const stale = draft({
      views: {
        portrait: approved('p'),
        front: slot({ status: 'stale', hash: 'f', origin: 'generated' }),
        left: approved('t'),
      },
    });
    expect(saveBlocker(stale, 'Maren')).toBe('Redo the full body first');
    const done = draft({ views: allSix });
    expect(saveBlocker(done, '  ')).toBe('Give them a name');
    expect(saveBlocker(done, 'Maren')).toBeNull();
  });
});

describe('the three things a roll cannot guess', () => {
  const T = (p: Partial<Traits> = {}): Traits => ({ ...NO_TRAITS, ...p });

  it('leads the sentence in the order a person would say them', () => {
    expect(
      castSentence(T({ steer: 'woman', age: '30s', tone: 'olive', hair: 'black' }), 'natural curls, calm expression'),
    ).toBe('a woman in her 30s with olive skin and black hair, natural curls, calm expression');
    expect(castSentence(T({ steer: 'man', age: '60+' }), 'close-cropped beard')).toBe(
      'a man in his 60s or older, close-cropped beard',
    );
    expect(castSentence(T({ steer: 'androgynous', tone: 'deep' }), 'platinum buzz cut')).toBe(
      'an androgynous person with deep brown skin, platinum buzz cut',
    );
    // an age with nobody to own it still reads as a sentence
    expect(castSentence(T({ age: '40s' }), 'quietly confident')).toBe('someone in their 40s, quietly confident');
  });

  it('drops any part the sentence already covers, rather than saying it twice', () => {
    expect(castSentence(T({ steer: 'man' }), 'a guy with a full beard')).toBe('a guy with a full beard');
    expect(castSentence(T({ steer: 'woman', age: '30s' }), 'a woman in her forties')).toBe('a woman in her forties');
    expect(castSentence(T({ tone: 'fair', hair: 'red' }), 'freckled skin, red hair')).toBe('freckled skin, red hair');
    // one of the two said, the other not: only the missing half is added
    expect(castSentence(T({ tone: 'deep', hair: 'black' }), 'a shaved head')).toBe(
      'with deep brown skin, a shaved head',
    );
    expect(castSentence(NO_TRAITS, 'someone warm')).toBe('someone warm');
    expect(castSentence(T({ steer: 'man' }), '   ')).toBe('');
  });
});

describe('a colour becomes a word', () => {
  it('names the nearest hair colour, because a hex in a prompt is dropped or guessed', () => {
    expect(hairName('#1a1817')).toBe('jet black');
    expect(hairName('#d9b26a')).toBe('honey blonde');
    expect(hairName('#a98cd4')).toBe('lavender');
    expect(hairName('#2f9a94')).toBe('teal');
    expect(hairName('not a colour')).toBe('dyed');
  });

  it('sends the picked colour as those words', () => {
    const t = { ...NO_TRAITS, hair: '#e374a6' };
    expect(castSentence(t, 'a sharp bob')).toBe('with pink hair, a sharp bob');
  });
});

describe('what the person is filed under', () => {
  it("opens with the engine's reading, once, and never argues with a choice", () => {
    const read = draft({ analysis: { suitableCategories: ['Beauty', 'Apparel'] } });
    expect(seedCategories(read, [])).toEqual(['Beauty', 'Apparel']);
    // someone who has already chosen is left alone, and so is an emptied line
    expect(seedCategories(read, ['Fitness'])).toBeNull();
    expect(seedCategories(draft(), [])).toBeNull();
    expect(seedCategories(draft({ analysis: { suitableCategories: [] } }), [])).toBeNull();
  });
});

describe('photos', () => {
  it('a failed read is said out loud, with the first photo standing in as the face', () => {
    const d = draft({
      source: 'photos',
      sources: ['a', 'b'],
      readError: 'the usage limit is used up until 11:17 PM',
      views: { portrait: approved('a', 'photo') },
    });
    const line = coverageLine(d, true);
    expect(line?.tone).toBe('warn');
    expect(line?.text).toBe(
      'The photos could not be read: the usage limit is used up until 11:17 PM. Your first photo is the face.',
    );
  });

  it('the coverage line says which views the photos are, and warns about a second person', () => {
    const one = draft({ source: 'photos', sources: ['a'], views: { portrait: approved('a', 'photo') } });
    expect(coverageLine(one, true)?.text).toBe(
      'Face from your photo. Full body and three-quarter view are drawn from them.',
    );
    expect(coverageLine(one, false)?.text).toContain('saved from the photos as they are');
    const two = draft({
      source: 'photos',
      sources: ['a', 'b'],
      views: { portrait: approved('a', 'photo'), front: approved('b', 'photo') },
    });
    expect(coverageLine(two, true)?.text).toBe(
      'Face and full body from your photos. Three-quarter view is drawn from them.',
    );
    expect(coverageLine({ ...one, stage: 'analyzing' }, true)).toBeNull();
    expect(coverageLine(draft(), true)).toBeNull();
    const conflict = { ...one, analysis: { conflict: 'the second photo has a rounder face' } };
    expect(coverageLine(conflict, true)).toEqual({
      text: 'These photos may show more than one person: the second photo has a rounder face',
      tone: 'warn',
    });
  });
});

describe('what reads as a person', () => {
  it('needs a noun, an age, hair, skin, build, a face, a presence or an origin; a pronoun alone is not enough', () => {
    for (const t of [
      'a woman in her 30s',
      'silver hair',
      'tall guy',
      'freckles and a warm smile',
      'Mediterranean, olive skin',
      'older',
      'athletic',
      'someone in their 50s',
    ])
      expect([t, readsAsPerson(t)]).toEqual([t, true]);
    for (const t of [
      'how are you?',
      'i want to create a presenter',
      'a florist from Paris who sells tulips',
      'show me her',
      'bullshit',
      '35',
    ])
      expect([t, readsAsPerson(t)]).toEqual([t, false]);
  });
});

describe('doingLine', () => {
  it('names the view being drawn, and says when it is drawn over a picture it already has', () => {
    expect(doingLine(draft({ stage: 'analyzing' }))).toBe('Reading the photos');
    expect(doingLine(draft({ stage: 'idle', activeView: null }))).toBeUndefined();
    expect(doingLine(draft({ stage: 'drawing', activeView: 'portrait' }))).toBe('Drawing the face');
    expect(doingLine(draft({ stage: 'drawing', activeView: 'portrait', views: { portrait: approved('p0') } }))).toBe(
      'Adjusting the face',
    );
    expect(doingLine(draft({ stage: 'drawing', activeView: 'front' }))).toBe('Drawing the full body');
    expect(doingLine(draft({ stage: 'drawing', activeView: 'front', views: { front: approved('f0') } }))).toBe(
      'Redrawing the full body',
    );
  });
});
