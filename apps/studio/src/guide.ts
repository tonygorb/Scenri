import { useSyncExternalStore } from 'react';
import { api, type GuideIntent, type GuideView } from './api.js';

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
  /** First steps was asked for from Help on this page: it shows even with every step done, so each can be done again. */
  asked: boolean;
}

const EMPTY: GuideSnapshot = {
  loaded: false,
  asked: false,
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

let snapshot: GuideSnapshot = EMPTY;
let loading: Promise<void> | null = null;
let reading: Promise<void> | null = null;
let listening = false;
const listeners = new Set<() => void>();

function emit(next: GuideSnapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

function read(): Promise<void> {
  reading ??= api
    .guide()
    .then((r) => emit({ ...r, loaded: true, asked: snapshot.asked }))
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
  if ('hidden' in i) return { ...s, hidden: i.hidden, asked: i.hidden ? false : s.asked };
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
    .then((r) => emit({ ...r, loaded: true, asked: snapshot.asked }))
    .catch(() => {
      emit(before);
      void read();
    });
}

/** Help's First steps: shown again, and kept on screen even when there is nothing left to do. */
export function askForFirstSteps(): Promise<void> {
  emit({ ...snapshot, asked: true });
  return guideIntent({ hidden: false });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
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
