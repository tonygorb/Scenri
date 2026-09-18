import { useSyncExternalStore } from 'react';
import { api, type GuideIntent, type GuideView } from './api.js';
import { FIRST_USE } from './firstUse.js';

/**
 * The install's first-use record, held once for the whole studio (DESIGN.md,
 * "First use"). The server owns it, so every browser and a phone on the network
 * agree; this keeps a copy that changes the moment an intent is sent, and takes
 * the server's answer when it comes back.
 *
 * Loaded on its own, never beside the brands in the shell's refresh: a studio
 * pointed at a server that predates the route keeps working, and a missed load
 * only means nobody is guided.
 */
export interface GuideSnapshot extends GuideView {
  /** The first read has answered, or failed. Until then nobody can tell a new install from an old one. */
  loaded: boolean;
  /**
   * The brand whose first shot was just begun away from Create, on its way
   * there: this tab's alone, never the record's. It lasts through a reload,
   * so the way is still lit after one, and ends on arrival or when the guide
   * is closed.
   */
  heading: string | null;
}

const HEADING = 'scenri:guide-heading';
function storedHeading(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage.getItem(HEADING);
  } catch {
    return null;
  }
}
function storeHeading(brandId: string | null): void {
  try {
    if (brandId) window.sessionStorage.setItem(HEADING, brandId);
    else window.sessionStorage.removeItem(HEADING);
  } catch {
    // a tab that refuses storage loses the way on a reload, nothing else
  }
}

const EMPTY: GuideSnapshot = {
  loaded: false,
  heading: null,
  eligible: false,
  welcome: null,
  hidden: true,
  done: {},
  dismissed: [],
  active: null,
  activeNodes: [],
  activeDraftId: null,
  counts: null,
};

let snapshot: GuideSnapshot = { ...EMPTY, heading: storedHeading() };
let loading: Promise<void> | null = null;
let reading: Promise<void> | null = null;
let listening = false;
const listeners = new Set<() => void>();

function emit(next: GuideSnapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

/**
 * The server's answer as this build takes it. With first use paused
 * (firstUse.ts) nobody is new and nothing is in hand, whatever the record says:
 * a task begun on a build that offered it waits there for one that does.
 */
function taken(r: GuideView): GuideSnapshot {
  const view = FIRST_USE
    ? r
    : { ...r, eligible: false, hidden: true, active: null, activeNodes: [], activeDraftId: null };
  return { ...view, loaded: true, heading: snapshot.heading };
}

function read(): Promise<void> {
  reading ??= api
    .guide()
    .then((r) => emit(taken(r)))
    .catch(() => {
      if (!snapshot.loaded) emit({ ...snapshot, loaded: true });
    })
    .finally(() => {
      reading = null;
    });
  return reading;
}

/** Once per page. Coming back to the tab reads it again, so another browser's progress shows. */
export function loadGuide(): Promise<void> {
  if (!listening && typeof document !== 'undefined') {
    listening = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && snapshot.loaded) void read();
    });
  }
  loading ??= read();
  return loading;
}

/** Read it again: after something a task watches for may have happened. */
export function refreshGuide(): Promise<void> {
  return read();
}

/** What an intent changes, applied at once so the screen never waits on the round trip. */
function optimistic(s: GuideSnapshot, i: GuideIntent): GuideSnapshot {
  if ('welcome' in i) return { ...s, welcome: i.welcome };
  if ('hidden' in i) return { ...s, hidden: i.hidden };
  if ('finish' in i)
    return s.active?.task === i.finish ? { ...s, active: null, activeNodes: [], activeDraftId: null } : s;
  if ('dismiss' in i)
    return {
      ...s,
      dismissed: s.dismissed.includes(i.dismiss) ? s.dismissed : [...s.dismissed, i.dismiss],
      ...(s.active?.task === i.dismiss ? { active: { ...s.active, paused: true } } : {}),
    };
  return s;
}

/** Sends one intent. A failed write puts the copy back as the server last said it. */
export function guideIntent(i: GuideIntent): Promise<void> {
  const before = snapshot;
  emit(optimistic(snapshot, i));
  return api
    .guideIntent(i)
    .then((r) => emit(taken(r)))
    .catch(() => {
      emit(before);
      void read();
    });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Where this browser remembers that a brand's first shot began with the way to Create. */
export const viaBarKey = (brandId: string) => `scenri:guide-via-bar:${brandId}`;

/** The first shot begun away from Create: its first step is the way there. */
export function headFor(brandId: string): void {
  storeHeading(brandId);
  emit({ ...snapshot, heading: brandId });
}

/** There, or no longer on the way. */
export function arrived(): void {
  storeHeading(null);
  if (snapshot.heading) emit({ ...snapshot, heading: null });
}

export function guideSnapshot(): GuideSnapshot {
  return snapshot;
}

export function useGuide(): GuideSnapshot {
  return useSyncExternalStore(subscribe, guideSnapshot);
}

/** Tests only: a fresh page. */
export function resetGuideForTests(): void {
  snapshot = EMPTY;
  loading = null;
  reading = null;
  listeners.clear();
}
