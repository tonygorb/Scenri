import { useSyncExternalStore } from 'react';
import { guideSnapshot, learn } from './guide.js';
import { tourConcept, type TourId } from './tours.js';

const LAST_CREATE_STOP = 'create.generate';

/**
 * The tour on screen, held once for the studio: which page, which stop, and
 * whether it was asked for from the help menu. The host decides where a stop
 * points and when a tour may begin; the composer and the rail only say that
 * the step a stop names has been taken.
 *
 * Back walks the tour's own history, never the product's: a chip added, a
 * picture chosen or a page opened stays exactly as it is. `behind` holds the
 * stops shown before this one and `ahead` the ones stepped back over, so Next
 * returns through what was already seen before it reaches anything new.
 *
 * Nothing about it is stored. A tour left half way is remembered for the
 * session, so coming back picks it up; a reload begins that tour again.
 */
export interface Visit {
  at: number;
  id: string;
}

export interface TourState {
  page: TourId;
  at: number;
  /** The stop on screen, so a signal only moves the tour from the stop it is about. */
  stopId: string | null;
  replay: boolean;
  /** Stops shown before this one, oldest first. */
  behind: readonly Visit[];
  /** Stops stepped back over, nearest first. */
  ahead: readonly Visit[];
  /** Reached by Back, or by Next through `ahead`: shown even if its step has since been taken. */
  revisit: boolean;
}

let state: TourState | null = null;
const resumeAt = new Map<TourId, number>();
const listeners = new Set<() => void>();
/** The welcome is on screen. Held here, beside the tour, so What's New can wait for both. */
let welcome = false;
const welcomeListeners = new Set<() => void>();

export function setWelcomeOpen(open: boolean): void {
  if (welcome === open) return;
  welcome = open;
  for (const l of welcomeListeners) l();
}

export function useWelcomeOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      welcomeListeners.add(l);
      return () => welcomeListeners.delete(l);
    },
    () => welcome,
  );
}

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
  emit({
    page,
    at: replay ? 0 : (resumeAt.get(page) ?? 0),
    stopId: null,
    replay,
    behind: [],
    ahead: [],
    revisit: false,
  });
}

/**
 * The host settled on a stop. Moving on from a stop that was on screen (its
 * target went away) still counts it as seen.
 */
export function settleStop(at: number, stopId: string): void {
  if (!state || (state.at === at && state.stopId === stopId)) return;
  const behind = state.stopId ? [...state.behind, { at: state.at, id: state.stopId }] : state.behind;
  emit({ ...state, at, stopId, behind, ahead: state.ahead.filter((v) => v.at > at), revisit: false });
}

/** Next, from the stop the press was made on. A press that arrives after the stop changed does nothing. */
export function nextStop(from?: string): void {
  if (!state || (from !== undefined && from !== state.stopId)) return;
  const behind = state.stopId ? [...state.behind, { at: state.at, id: state.stopId }] : state.behind;
  const [again, ...rest] = state.ahead;
  if (again) emit({ ...state, at: again.at, stopId: again.id, behind, ahead: rest, revisit: true });
  else emit({ ...state, at: state.at + 1, stopId: null, behind, revisit: false });
}

/** Back, to the stop shown before this one. Only the tour moves. */
export function backStop(from: string): void {
  if (!state || from !== state.stopId) return;
  const prev = state.behind.at(-1);
  if (!prev) return;
  emit({
    ...state,
    at: prev.at,
    stopId: prev.id,
    behind: state.behind.slice(0, -1),
    ahead: [{ at: state.at, id: from }, ...state.ahead],
    revisit: true,
  });
}

/** The step a stop names was taken. Moves the tour only if that stop is the one on screen. */
export function advanceTour(page: TourId, stopId: string): void {
  if (state?.page === page && state.stopId === stopId) nextStop(stopId);
}

/** The page changed under a running tour: close it without teaching anything, and remember the furthest stop. */
export function leaveTour(o: { resumeAt?: number } = {}): void {
  if (!state) return;
  if (!state.replay) resumeAt.set(state.page, Math.max(o.resumeAt ?? state.at, ...state.ahead.map((v) => v.at)));
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

/**
 * A shot was sent while the Create tour is on screen: it moves on, and ends
 * once its last stop is the one showing. A send anywhere else teaches nothing,
 * so someone who first sends from Home still meets the Create tour.
 */
export function sentAShot(): void {
  if (state?.page !== 'create' || !state.stopId) return;
  if (state.stopId === LAST_CREATE_STOP && state.ahead.length === 0) endTour('create', { skipped: false });
  else nextStop(state.stopId);
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
  welcome = false;
  welcomeListeners.clear();
}
