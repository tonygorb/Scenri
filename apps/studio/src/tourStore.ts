import { useSyncExternalStore } from 'react';
import { guideSnapshot, learn } from './guide.js';
import { tourConcept, type TourId } from './tours.js';

/**
 * The tour on screen, held once for the studio: which page, which stop, and
 * whether it was asked for from the help menu. The host decides where a stop
 * points and when a tour may begin; the composer and the rail only say that
 * the step a stop names has been taken.
 *
 * Nothing about it is stored. A tour left half way is remembered for the
 * session, so coming back picks it up; a reload begins again at its first
 * step not yet taken.
 */
export interface TourState {
  page: TourId;
  at: number;
  /** The stop on screen, so a signal only moves the tour from the stop it is about. */
  stopId: string | null;
  replay: boolean;
}

let state: TourState | null = null;
const resumeAt = new Map<TourId, number>();
const listeners = new Set<() => void>();

function emit(next: TourState | null) {
  state = next;
  for (const l of listeners) l();
}

export function tourSnapshot(): TourState | null {
  return state;
}

export function useTour(): TourState | null {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, tourSnapshot);
}

export function startTour(page: TourId, o: { replay?: boolean } = {}): void {
  const replay = !!o.replay;
  emit({ page, at: replay ? 0 : (resumeAt.get(page) ?? 0), stopId: null, replay });
}

/** The host settled on a stop: the first one not yet taken at or after where the tour was. */
export function settleStop(at: number, stopId: string): void {
  if (!state || (state.at === at && state.stopId === stopId)) return;
  emit({ ...state, at, stopId });
}

export function nextStop(): void {
  if (state) emit({ ...state, at: state.at + 1, stopId: null });
}

/** The step a stop names was taken. Moves the tour only if that stop is the one on screen. */
export function advanceTour(page: TourId, stopId: string): void {
  if (state?.page === page && state.stopId === stopId) nextStop();
}

/** The page changed under a running tour: close it without teaching anything, and remember the stop. */
export function leaveTour(o: { resumeAt?: number } = {}): void {
  if (!state) return;
  if (!state.replay) resumeAt.set(state.page, o.resumeAt ?? state.at);
  emit(null);
}

/**
 * A tour ended. Finishing and skipping both mean it is never offered again;
 * a second skip of a different tour means the person does not want tours,
 * and no more begin on their own. A replay is never counted as a skip.
 */
export function endTour(page: TourId, o: { skipped: boolean }): void {
  const replay = state?.page === page && state.replay;
  if (state?.page === page) emit(null);
  resumeAt.delete(page);
  learn(tourConcept(page));
  if (!o.skipped || replay) return;
  if (guideSnapshot().learned.includes('tour-skip')) learn('tours-off');
  else learn('tour-skip');
}

/** A shot was sent: that is what the Create tour teaches, whether or not it is on screen. */
export function sentAShot(): void {
  if (state?.page === 'create') endTour('create', { skipped: false });
  else learn(tourConcept('create'));
}

/** The tours were started over: no half-finished one is picked up where it stopped. */
export function forgetTourProgress(): void {
  resumeAt.clear();
}

/** Tests only: a fresh page. */
export function resetToursForTests(): void {
  state = null;
  resumeAt.clear();
  listeners.clear();
}
