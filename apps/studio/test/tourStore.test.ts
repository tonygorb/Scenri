import { describe, it, expect, beforeEach, vi } from 'vitest';

const learned: string[] = [];
vi.mock('../src/guide.js', () => ({
  learn: (c: string) => {
    if (!learned.includes(c)) learned.push(c);
  },
  guideSnapshot: () => ({ eligible: true, learned }),
}));

const {
  advanceTour,
  backStop,
  endTour,
  forgetTourProgress,
  leaveTour,
  nextStop,
  resetToursForTests,
  sentAShot,
  settleStop,
  startTour,
  tourSnapshot,
} = await import('../src/tourStore.js');

beforeEach(() => {
  resetToursForTests();
  learned.length = 0;
});

describe('tour store', () => {
  it('starts at the first stop and moves with Next', () => {
    startTour('home');
    expect(tourSnapshot()).toEqual({
      page: 'home',
      at: 0,
      stopId: null,
      replay: false,
      behind: [],
      ahead: [],
      revisit: false,
    });
    settleStop(0, 'home.start');
    nextStop('home.start');
    expect(tourSnapshot()?.at).toBe(1);
  });

  it('a signal moves the tour only from the stop it is about', () => {
    startTour('create');
    settleStop(0, 'create.add');
    advanceTour('create', 'create.prompt');
    expect(tourSnapshot()?.at).toBe(0);
    advanceTour('home', 'create.add');
    expect(tourSnapshot()?.at).toBe(0);
    advanceTour('create', 'create.add');
    expect(tourSnapshot()?.at).toBe(1);
  });

  it('finishing learns the tour once and is never a skip', () => {
    startTour('products');
    endTour('products', { skipped: false });
    expect(tourSnapshot()).toBeNull();
    expect(learned).toEqual(['tour-products']);
  });

  it('a first skip is noted, a second different skip turns tours off', () => {
    startTour('products');
    endTour('products', { skipped: true });
    expect(learned).toEqual(['tour-products', 'tour-skip']);
    startTour('scenes');
    endTour('scenes', { skipped: true });
    expect(learned).toEqual(['tour-products', 'tour-skip', 'tour-scenes', 'tours-off']);
  });

  it('a replay starts at the beginning and is never counted as a skip', () => {
    startTour('home');
    settleStop(2, 'home.create');
    leaveTour();
    startTour('home', { replay: true });
    expect(tourSnapshot()?.at).toBe(0);
    endTour('home', { skipped: true });
    expect(learned).toEqual(['tour-home']);
  });

  it('leaving remembers the stop for the session; replay leaves nothing behind', () => {
    startTour('presenters');
    settleStop(1, 'presenters.ours');
    leaveTour();
    expect(tourSnapshot()).toBeNull();
    expect(learned).toEqual([]);
    startTour('presenters');
    expect(tourSnapshot()?.at).toBe(1);
    leaveTour({ resumeAt: 0 });
    startTour('presenters');
    expect(tourSnapshot()?.at).toBe(0);
  });

  it('sending a shot moves the Create tour on and ends it from its last stop; elsewhere it teaches nothing', () => {
    startTour('create');
    settleStop(0, 'create.add');
    sentAShot();
    expect(tourSnapshot()?.at).toBe(1);
    settleStop(2, 'create.generate');
    sentAShot();
    expect(tourSnapshot()).toBeNull();
    expect(learned).toEqual(['tour-create']);
    learned.length = 0;
    startTour('home');
    sentAShot();
    expect(tourSnapshot()?.page).toBe('home');
    expect(learned).toEqual([]);
  });

  it('Back shows the stop seen before and Next returns through it before anything new', () => {
    startTour('home');
    settleStop(0, 'home.start');
    nextStop('home.start');
    settleStop(1, 'home.examples');
    nextStop('home.examples');
    settleStop(2, 'home.create');
    backStop('home.create');
    expect(tourSnapshot()).toMatchObject({ at: 1, stopId: 'home.examples', revisit: true });
    backStop('home.examples');
    expect(tourSnapshot()).toMatchObject({ at: 0, stopId: 'home.start', behind: [] });
    backStop('home.start');
    expect(tourSnapshot()?.at).toBe(0);
    nextStop('home.start');
    expect(tourSnapshot()).toMatchObject({ at: 1, stopId: 'home.examples', revisit: true });
    nextStop('home.examples');
    expect(tourSnapshot()).toMatchObject({ at: 2, stopId: 'home.create', ahead: [] });
    nextStop('home.create');
    expect(tourSnapshot()).toMatchObject({ at: 3, stopId: null, revisit: false });
  });

  it('a press from a stop no longer on screen does nothing', () => {
    startTour('products');
    settleStop(0, 'products.add');
    nextStop('products.add');
    settleStop(1, 'products.ours');
    nextStop('products.add');
    backStop('products.add');
    expect(tourSnapshot()).toMatchObject({ at: 1, stopId: 'products.ours' });
  });

  it('a stop whose target went away is still counted as seen', () => {
    startTour('home');
    settleStop(0, 'home.start');
    settleStop(1, 'home.examples');
    expect(tourSnapshot()?.behind).toEqual([{ at: 0, id: 'home.start' }]);
  });

  it('leaving after stepping back resumes at the furthest stop reached', () => {
    startTour('scenes');
    settleStop(0, 'scenes.add');
    nextStop('scenes.add');
    settleStop(1, 'scenes.ours');
    backStop('scenes.ours');
    leaveTour();
    startTour('scenes');
    expect(tourSnapshot()).toMatchObject({ at: 1, behind: [], ahead: [] });
  });

  it('starting over forgets where a half-finished tour stopped', () => {
    startTour('scenes');
    settleStop(1, 'scenes.ours');
    leaveTour();
    forgetTourProgress();
    startTour('scenes');
    expect(tourSnapshot()?.at).toBe(0);
  });
});
