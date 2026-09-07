import { describe, it, expect } from 'vitest';
import {
  STUDIO_VIEWS,
  allApproved,
  currentView,
  identityLocked,
  nextToDraw,
  saveBlocker,
  stageCopy,
  stripItems,
  worthKeeping,
  type DraftLike,
  type Slot,
} from '../src/views/presenterStudio/studioRules.js';

const slot = (over: Partial<Slot> = {}): Slot => ({ status: 'empty', attempts: 0, rejected: [], ...over });
const draft = (over: Partial<DraftLike> = {}): DraftLike => ({
  source: 'synthetic',
  name: '',
  views: { portrait: slot(), front: slot(), 'three-quarter': slot() },
  activeView: null,
  stage: 'idle',
  ...over,
});
const H = (c: string) => c.repeat(32);

describe('which view the studio is on', () => {
  it('is the first view not yet approved, in build order', () => {
    expect(currentView(draft())).toBe('portrait');
    const d = draft({
      views: { portrait: slot({ status: 'approved', hash: H('a') }), front: slot(), 'three-quarter': slot() },
    });
    expect(currentView(d)).toBe('front');
    const stale = draft({
      views: {
        portrait: slot({ status: 'approved', hash: H('a') }),
        front: slot({ status: 'approved', hash: H('b') }),
        'three-quarter': slot({ status: 'stale', hash: H('c') }),
      },
    });
    expect(currentView(stale)).toBe('three-quarter');
  });

  it('is nothing once all three are approved, which is the review', () => {
    const done = draft({
      views: {
        portrait: slot({ status: 'approved', hash: H('a') }),
        front: slot({ status: 'approved', hash: H('b') }),
        'three-quarter': slot({ status: 'approved', hash: H('c') }),
      },
    });
    expect(currentView(done)).toBeNull();
    expect(allApproved(done)).toBe(true);
    expect(allApproved(draft())).toBe(false);
  });
});

describe('what gets drawn next without a click', () => {
  it('draws an empty view whose dependencies are approved, once the draft is idle', () => {
    expect(nextToDraw(draft())).toBe('portrait');
    const locked = draft({
      views: { portrait: slot({ status: 'approved', hash: H('a') }), front: slot(), 'three-quarter': slot() },
    });
    expect(nextToDraw(locked)).toBe('front');
  });

  it('never draws over a candidate, a failure, a busy draft, or a view whose dependency is missing', () => {
    expect(
      nextToDraw(
        draft({
          views: { portrait: slot({ status: 'candidate', hash: H('a') }), front: slot(), 'three-quarter': slot() },
        }),
      ),
    ).toBeNull();
    expect(
      nextToDraw(draft({ views: { portrait: slot({ error: 'quota' }), front: slot(), 'three-quarter': slot() } })),
    ).toBeNull();
    expect(nextToDraw(draft({ stage: 'analyzing' }))).toBeNull();
    expect(
      nextToDraw(
        draft({
          activeView: 'portrait',
          views: { portrait: slot({ status: 'generating' }), front: slot(), 'three-quarter': slot() },
        }),
      ),
    ).toBeNull();
    // front cannot be drawn until the portrait is approved, and a stale view is redrawn only by hand
    expect(
      nextToDraw(
        draft({
          views: { portrait: slot({ status: 'candidate', hash: H('a') }), front: slot(), 'three-quarter': slot() },
        }),
      ),
    ).toBeNull();
    expect(
      nextToDraw(
        draft({
          views: {
            portrait: slot({ status: 'approved', hash: H('a') }),
            front: slot({ status: 'stale', hash: H('b') }),
            'three-quarter': slot(),
          },
        }),
      ),
    ).toBeNull();
  });
});

describe('the strip is the progress', () => {
  it('names each view and its state, the current one marked', () => {
    const d = draft({
      views: {
        portrait: slot({ status: 'approved', hash: H('a') }),
        front: slot({ status: 'candidate', hash: H('b') }),
        'three-quarter': slot(),
      },
    });
    expect(stripItems(d, null)).toEqual([
      { view: 'portrait', label: 'Portrait', state: 'approved', hash: H('a'), photo: false },
      { view: 'front', label: 'Full body', state: 'current', hash: H('b'), photo: false },
      { view: 'three-quarter', label: 'Three-quarter', state: 'todo', hash: undefined, photo: false },
    ]);
  });

  it('a slot filled by one of their own photos says so, and a stale one is stale even when it is not current', () => {
    const d = draft({
      source: 'photos',
      views: {
        portrait: slot({ status: 'approved', hash: H('a'), origin: 'photo' }),
        front: slot({ status: 'stale', hash: H('b'), origin: 'generated' }),
        'three-quarter': slot({ status: 'stale', hash: H('c'), origin: 'generated' }),
      },
    });
    const items = stripItems(d, null);
    expect(items[0]).toMatchObject({ state: 'approved', photo: true });
    expect(items[1]).toMatchObject({ state: 'current' });
    expect(items[2]).toMatchObject({ state: 'stale' });
    // a view the person clicked on is the current one, whatever the build order says
    expect(stripItems(d, 'portrait')[0].state).toBe('current');
  });
});

describe('what the stage says', () => {
  it('speaks to the state of the view, in the words the buttons use', () => {
    expect(stageCopy('portrait', slot({ status: 'generating' }), 'synthetic', 'drawing').title).toBe(
      'Drawing the portrait',
    );
    expect(stageCopy('front', slot({ status: 'generating' }), 'photos', 'analyzing').title).toBe('Reading the photos');
    expect(stageCopy('portrait', slot({ status: 'candidate', hash: H('a') }), 'synthetic', 'idle')).toEqual({
      title: 'This is the person',
      hint: 'Approve them to build the rest on this face, or try another.',
    });
    expect(stageCopy('front', slot({ status: 'candidate', hash: H('b') }), 'synthetic', 'idle').title).toBe(
      'Full body',
    );
    expect(stageCopy('front', slot({ status: 'stale', hash: H('b') }), 'synthetic', 'idle').hint).toMatch(/changed/);
    expect(stageCopy('front', slot({ error: 'the engine fell over' }), 'synthetic', 'idle').hint).toContain(
      'the engine fell over',
    );
    expect(
      stageCopy('portrait', slot({ status: 'approved', hash: H('a'), origin: 'photo' }), 'photos', 'idle').hint,
    ).toMatch(/your photo/i);
  });
});

describe('leaving and saving', () => {
  it('a draft is worth a word before it is thrown away once something was approved or drawn', () => {
    expect(worthKeeping(draft())).toBe(false);
    expect(
      worthKeeping(
        draft({
          views: { portrait: slot({ status: 'candidate', hash: H('a') }), front: slot(), 'three-quarter': slot() },
        }),
      ),
    ).toBe(true);
    // a photo placed in a slot cost nothing and is still on disk as itself
    expect(
      worthKeeping(
        draft({
          source: 'photos',
          views: {
            portrait: slot({ status: 'approved', hash: H('a'), origin: 'photo' }),
            front: slot(),
            'three-quarter': slot(),
          },
        }),
      ),
    ).toBe(false);
  });

  it('the identity is locked once the portrait is approved', () => {
    expect(identityLocked(draft())).toBe(false);
    expect(
      identityLocked(
        draft({
          views: { portrait: slot({ status: 'approved', hash: H('a') }), front: slot(), 'three-quarter': slot() },
        }),
      ),
    ).toBe(true);
  });

  it('save is blocked by the first missing thing, in the order a person would fix them', () => {
    const done = draft({
      views: {
        portrait: slot({ status: 'approved', hash: H('a') }),
        front: slot({ status: 'approved', hash: H('b') }),
        'three-quarter': slot({ status: 'approved', hash: H('c') }),
      },
    });
    expect(saveBlocker(done, '')).toBe('Give them a name');
    expect(saveBlocker(done, 'Ilse')).toBeNull();
    const short = draft({
      views: { portrait: slot({ status: 'approved', hash: H('a') }), front: slot(), 'three-quarter': slot() },
    });
    expect(saveBlocker(short, 'Ilse')).toBe('Approve the full body first');
    expect(saveBlocker(draft({ stage: 'drawing', activeView: 'front' }), 'Ilse')).toBe('Still drawing');
  });
});

describe('the order', () => {
  it('is portrait, full body, three-quarter', () => {
    expect(STUDIO_VIEWS).toEqual(['portrait', 'front', 'three-quarter']);
  });
});
