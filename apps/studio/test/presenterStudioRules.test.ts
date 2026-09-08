import { describe, expect, it } from 'vitest';
import type { PresenterDraftSlot } from '../src/api.js';
import {
  VIEWS,
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
  selectedView,
  stripItems,
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
    views: { portrait: emptySlot(), front: emptySlot(), 'three-quarter': emptySlot(), ...(p.views ?? {}) },
  };
}

describe('the order: face, full body, three-quarter', () => {
  it('is three views, and the current one is the first not yet used', () => {
    expect(VIEWS).toEqual(['portrait', 'front', 'three-quarter']);
    expect(currentView(draft())).toBe('portrait');
    expect(currentView(draft({ views: { portrait: approved('p') } }))).toBe('front');
    expect(
      currentView(draft({ views: { portrait: approved('p'), front: approved('f'), 'three-quarter': approved('t') } })),
    ).toBeNull();
  });
});

describe('phases', () => {
  it('is identity until the face is used, build until everything stands, then review', () => {
    expect(phaseOf(draft(), true)).toBe('identity');
    expect(phaseOf(draft({ views: { portrait: candidate('c') } }), true)).toBe('identity');
    expect(phaseOf(draft({ views: { portrait: approved('p') } }), true)).toBe('build');
    const done = draft({ views: { portrait: approved('p'), front: approved('f'), 'three-quarter': approved('t') } });
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
        'three-quarter': slot({ status: 'stale', hash: 't', origin: 'generated' }),
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
    // a chosen view wins over the one being drawn
    expect(selectedView(d, 'portrait')).toBe('portrait');
    expect(stripItems(d, 'portrait')[0]).toMatchObject({ state: 'current', label: 'Face', photo: false });
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
    expect(railCopy(front, 'front', true).status).toContain('Full body');
  });

  it('offers Use or Keep previous on a revision, Retry on a failure, and nothing while drawing', () => {
    const done = draft({
      name: 'Maren',
      views: {
        portrait: candidate('c', { prior: 'p', adjustment: 'shorter hair' }),
        front: approved('f'),
        'three-quarter': approved('t'),
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
        'three-quarter': approved('t'),
      },
    });
    expect(railCopy(busy, 'portrait', true)).toMatchObject({ actions: [] });
    expect(railCopy(busy, 'portrait', true).status).toContain('shorter hair');
  });

  it('says review is about one person, and names the naming', () => {
    const done = draft({ views: { portrait: approved('p'), front: approved('f'), 'three-quarter': approved('t') } });
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
    const d = draft({ views: { portrait: approved('p'), front: approved('f'), 'three-quarter': approved('t') } });
    expect(refineTarget('a little shorter hair', 'front', d)).toEqual({ view: 'portrait', scope: 'identity' });
    expect(refineTarget('older, mid 40s', 'three-quarter', d)).toEqual({ view: 'portrait', scope: 'identity' });
    expect(refineTarget('less athletic', 'front', d)).toEqual({ view: 'portrait', scope: 'identity' });
    expect(refineTarget('warmer expression', 'portrait', d)).toEqual({ view: 'portrait', scope: 'identity' });
    expect(refineTarget('turn slightly more to camera', 'front', d)).toEqual({ view: 'front', scope: 'view' });
    expect(refineTarget('arms relaxed at the sides', 'three-quarter', d)).toEqual({
      view: 'three-quarter',
      scope: 'view',
    });
    expect(refineHint('portrait', d)).toContain('Changes the person');
    expect(refineHint('front', d)).toContain('this view only');
  });

  it('never redraws a photograph', () => {
    const d = draft({
      source: 'photos',
      sources: ['a', 'b'],
      views: { portrait: approved('a', 'photo'), front: approved('b', 'photo'), 'three-quarter': approved('t') },
    });
    expect(refineTarget('shorter hair', 'three-quarter', d)).toEqual({
      blocked: 'Their photos define who they are. Change a drawn view instead.',
    });
    expect(refineTarget('turn to camera', 'front', d)).toEqual({
      blocked: 'Your photo stands as it is. Pick a drawn view to change.',
    });
    expect(refineTarget('turn to camera', 'three-quarter', d)).toEqual({ view: 'three-quarter', scope: 'view' });
    expect(refineHint('three-quarter', d)).toContain('Their photos define who they are');
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
    expect(saveBlocker(d, '')).toBe('Use the full body first');
    expect(saveBlocker({ ...d, activeView: 'front', stage: 'drawing' }, '')).toBe('Still drawing');
    const revision = draft({
      views: { portrait: candidate('c', { prior: 'p' }), front: approved('f'), 'three-quarter': approved('t') },
    });
    expect(saveBlocker(revision, 'Maren')).toBe('Decide on the face first');
    const stale = draft({
      views: {
        portrait: approved('p'),
        front: slot({ status: 'stale', hash: 'f', origin: 'generated' }),
        'three-quarter': approved('t'),
      },
    });
    expect(saveBlocker(stale, 'Maren')).toBe('Redo the full body first');
    const done = draft({ views: { portrait: approved('p'), front: approved('f'), 'three-quarter': approved('t') } });
    expect(saveBlocker(done, '  ')).toBe('Give them a name');
    expect(saveBlocker(done, 'Maren')).toBeNull();
  });
});

describe('photos', () => {
  it('the hint under the tiles counts', () => {
    expect(photosHint(0)).toContain('same person');
    expect(photosHint(1)).toContain('One photo works');
    expect(photosHint(3)).toContain('More angles');
    expect(photosHint(4)).toContain('Four angles');
  });

  it('the coverage line says which views the photos are, and warns about a second person', () => {
    const one = draft({ source: 'photos', sources: ['a'], views: { portrait: approved('a', 'photo') } });
    expect(coverageLine(one, true)?.text).toBe(
      'Face from your photo. Full body and three-quarter are drawn from them.',
    );
    expect(coverageLine(one, false)?.text).toContain('saved from the photos as they are');
    const two = draft({
      source: 'photos',
      sources: ['a', 'b'],
      views: { portrait: approved('a', 'photo'), front: approved('b', 'photo') },
    });
    expect(coverageLine(two, true)?.text).toBe(
      'Face and full body from your photos. Three-quarter is drawn from them.',
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
