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
  endTour,
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
    expect(tourSnapshot()).toEqual({ page: 'home', at: 0, stopId: null, replay: false });
    settleStop(0, 'home.start');
    nextStop();
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

  it('sending a shot ends the Create tour, or learns it when none is on screen', () => {
    startTour('create');
    sentAShot();
    expect(tourSnapshot()).toBeNull();
    expect(learned).toEqual(['tour-create']);
    learned.length = 0;
    startTour('home');
    sentAShot();
    expect(tourSnapshot()?.page).toBe('home');
    expect(learned).toEqual(['tour-create']);
  });
});
