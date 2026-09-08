import { describe, expect, it } from 'vitest';
import type { PresenterDraftSlot } from '../src/api.js';
import {
  type Traits,
  VIEWS,
  NO_TRAITS,
  castSentence,
  composerState,
  coverageLine,
  currentView,
  emptySlot,
  nextToDraw,
  phaseOf,
  photosHint,
  railCopy,
  refineHint,
  refineTarget,
  resumable,
  saveBlocker,
  seedCategories,
  selectedView,
  stripItems,
  whoHint,
  worthKeeping,
  type DraftLike,
  type StudioView,
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
      left: emptySlot(),
      back: emptySlot(),
      right: emptySlot(),
      ...(p.views ?? {}),
    },
  };
}

describe('the order: face, front, left, back, right', () => {
  it('is five views, and the current one is the first not yet used', () => {
    expect(VIEWS).toEqual(['portrait', 'front', 'left', 'back', 'right']);
    expect(currentView(draft())).toBe('portrait');
    expect(currentView(draft({ views: { portrait: approved('p') } }))).toBe('front');
    expect(
      currentView(
        draft({
          views: {
            portrait: approved('p'),
            front: approved('f'),
            left: approved('l'),
            back: approved('b'),
            right: approved('r'),
          },
        }),
      ),
    ).toBeNull();
  });
});

describe('phases', () => {
  it('is identity until the face is used, build until everything stands, then review', () => {
    expect(phaseOf(draft(), true)).toBe('identity');
    expect(phaseOf(draft({ views: { portrait: candidate('c') } }), true)).toBe('identity');
    expect(phaseOf(draft({ views: { portrait: approved('p') } }), true)).toBe('build');
    const done = draft({
      views: {
        portrait: approved('p'),
        front: approved('f'),
        left: approved('l'),
        back: approved('b'),
        right: approved('r'),
      },
    });
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
    expect(saveBlocker(d, 'Noor', true)).toBe('Use the front view first');
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
        left: slot({ status: 'stale', hash: 'l', origin: 'generated' }),
      },
    });
    expect(nextToDraw(d)).toBe('front');
    expect(nextToDraw({ ...d, views: { ...d.views, front: approved('f2') } })).toBe('left');
  });
});

describe('the strip is the progress', () => {
  it('marks what stands, what is on the stage, what is being drawn and what is still to come', () => {
    const d = draft({ activeView: 'front', stage: 'drawing', views: { portrait: approved('p') } });
    expect(selectedView(d, null)).toBe('front');
    expect(stripItems(d, 'front').map((i) => [i.view, i.state, i.drawing])).toEqual([
      ['portrait', 'approved', false],
      ['front', 'current', true],
      ['left', 'todo', false],
      ['back', 'todo', false],
      ['right', 'todo', false],
    ]);
    // a chosen view wins over the one being drawn
    expect(selectedView(d, 'portrait')).toBe('portrait');
    expect(stripItems(d, 'portrait')[0]).toMatchObject({ state: 'current', label: 'Avatar', photo: false });
    const photos = draft({ source: 'photos', views: { portrait: approved('a', 'photo') } });
    expect(stripItems(photos, 'front')[0]).toMatchObject({ state: 'approved', photo: true });
  });
});

describe('what the rail says', () => {
  it('asks the one question at the face, and offers Use or Try again on a built view', () => {
    const face = draft({ views: { portrait: candidate('c') } });
    expect(railCopy(face, 'portrait', true)).toMatchObject({ actions: ['try-again', 'use-person'] });
    const front = draft({ views: { portrait: approved('p'), front: candidate('f') } });
    expect(railCopy(front, 'front', true)).toMatchObject({ actions: ['try-again', 'use'] });
    expect(railCopy(front, 'front', true).status).toContain('Front view');
  });

  it('offers Use or Keep previous on a revision, Retry on a failure, and nothing while drawing', () => {
    const done = draft({
      name: 'Maren',
      views: {
        portrait: candidate('c', { prior: 'p', adjustment: 'shorter hair' }),
        front: approved('f'),
        left: approved('t'),
      },
    });
    const revision = railCopy(done, 'portrait', true);
    expect(revision.actions).toEqual(['keep-previous', 'use']);
    expect(revision.status).toContain('redraws the other views');
    const failed = draft({ views: { portrait: approved('p'), front: slot({ error: 'the engine timed out' }) } });
    expect(railCopy(failed, 'front', true)).toMatchObject({ tone: 'alert', actions: ['retry'] });
    expect(railCopy(failed, 'front', true).status).toContain('Nothing approved was touched');
    const busy = draft({
      activeView: 'portrait',
      stage: 'drawing',
      views: {
        portrait: candidate('c', { prior: 'p', adjustment: 'shorter hair' }),
        front: approved('f'),
        left: approved('t'),
      },
    });
    expect(railCopy(busy, 'portrait', true)).toMatchObject({ actions: [] });
    expect(railCopy(busy, 'portrait', true).status).toContain('shorter hair');
  });

  it('says review is about one person, and names the naming', () => {
    const done = draft({
      views: {
        portrait: approved('p'),
        front: approved('f'),
        left: approved('l'),
        back: approved('b'),
        right: approved('r'),
      },
    });
    expect(railCopy(done, 'portrait', true)).toMatchObject({ actions: ['save'] });
    expect(railCopy(done, 'portrait', true).status).toContain('name them');
    expect(railCopy({ ...done, name: 'Maren' }, 'front', true).status).toContain('then save');
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
    const d = draft({
      views: {
        portrait: approved('p'),
        front: approved('f'),
        left: approved('l'),
        back: approved('b'),
        right: approved('r'),
      },
    });
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
    const d = draft({
      views: {
        portrait: approved('p'),
        front: approved('f'),
        left: approved('l'),
        back: approved('b'),
        right: approved('r'),
      },
    });
    expect(composerState('', 'front', d).chip).toEqual({ view: 'front', label: 'Refining the front view' });
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
    expect(saveBlocker(d, '')).toBe('Use the front view first');
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
    expect(saveBlocker(stale, 'Maren')).toBe('Redo the front view first');
    const done = draft({
      views: {
        portrait: approved('p'),
        front: approved('f'),
        left: approved('l'),
        back: approved('b'),
        right: approved('r'),
      },
    });
    expect(saveBlocker(done, '  ')).toBe('Give them a name');
    expect(saveBlocker(done, 'Maren')).toBeNull();
  });
});

describe('the three things a roll cannot guess', () => {
  const T = (p: Partial<Traits> = {}): Traits => ({ ...NO_TRAITS, ...p });

  it('leads the sentence in the order a person would say them', () => {
    expect(castSentence(T({ steer: 'woman', age: '30s', tone: 'olive' }), 'natural curls, calm expression')).toBe(
      'a woman in her 30s with olive skin, natural curls, calm expression',
    );
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
    expect(castSentence(T({ tone: 'fair' }), 'freckled skin, red hair')).toBe('freckled skin, red hair');
    expect(castSentence(NO_TRAITS, 'someone warm')).toBe('someone warm');
    expect(castSentence(T({ steer: 'man' }), '   ')).toBe('');
  });

  it('says so only when nothing has named who this is', () => {
    expect(whoHint(NO_TRAITS, 'someone friendly in their 30s')).toContain('Nobody has said who this is');
    expect(whoHint(T({ steer: 'woman' }), 'someone friendly in their 30s')).toBeNull();
    expect(whoHint(NO_TRAITS, 'a woman in her forties')).toBeNull();
    expect(whoHint(NO_TRAITS, '')).toBeNull();
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
  it('the hint under the tiles counts', () => {
    expect(photosHint(0)).toContain('same person');
    expect(photosHint(1)).toContain('One photo works');
    expect(photosHint(3)).toContain('More angles');
    expect(photosHint(4)).toContain('Four angles');
  });

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
    expect(coverageLine(one, true)?.text).toBe('Face from your photo. The rest are drawn from them.');
    expect(coverageLine(one, false)?.text).toContain('saved from the photos as they are');
    const two = draft({
      source: 'photos',
      sources: ['a', 'b'],
      views: { portrait: approved('a', 'photo'), front: approved('b', 'photo') },
    });
    expect(coverageLine(two, true)?.text).toBe('Face and front view from your photos. The rest are drawn from them.');
    expect(coverageLine({ ...one, stage: 'analyzing' }, true)).toBeNull();
    expect(coverageLine(draft(), true)).toBeNull();
    const conflict = { ...one, analysis: { conflict: 'the second photo has a rounder face' } };
    expect(coverageLine(conflict, true)).toEqual({
      text: 'These photos may show more than one person: the second photo has a rounder face',
      tone: 'warn',
    });
  });
});
