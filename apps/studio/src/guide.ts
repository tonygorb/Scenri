import { useSyncExternalStore } from 'react';
import { api } from './api.js';

/** Everything the install can have been taught, in the server's own words (routes/guide.ts). */
export const CONCEPTS = [
  'welcome',
  'tour-home',
  'tour-create',
  'tour-products',
  'tour-presenters',
  'tour-scenes',
  'tour-skip',
  'tours-off',
  'refine',
] as const;
export type Concept = (typeof CONCEPTS)[number];

/**
 * The install's first-use record, held once for the whole studio. The server
 * owns it (every browser and a phone on the network read the same one); this
 * keeps a copy so a hint ends the instant it is learned, even when the
 * composer that learned it unmounts in the same commit, as Home's does when a
 * send moves you to Create.
 *
 * Loaded on its own, never beside the brands in the shell's refresh: a studio
 * pointed at a server that predates the route must keep working, and a missed
 * load only means nobody is taught.
 */
export interface GuideSnapshot {
  eligible: boolean;
  learned: readonly Concept[];
  /** The one read has answered, or failed. Until then nobody can tell a new install from an old one. */
  loaded: boolean;
  /** The tours were asked for from the help menu, so the install may not be new at all. */
  optedIn: boolean;
}

const EMPTY: GuideSnapshot = { eligible: false, learned: [], loaded: false, optedIn: false };
let snapshot: GuideSnapshot = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: GuideSnapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

const known = (c: string): c is Concept => (CONCEPTS as readonly string[]).includes(c);

/** Once per page. A learn that lands before the load is kept, and sent once the install is known to be new. */
export function loadGuide(): Promise<void> {
  loading ??= api
    .guide()
    .then((r) => {
      const server = r.learned.filter(known);
      const local = snapshot.learned.filter((c) => !server.includes(c));
      emit({ eligible: r.eligible, learned: [...server, ...local], loaded: true, optedIn: r.optedIn === true });
      if (r.eligible) for (const c of local) void api.guideLearned(c).catch(() => {});
    })
    .catch(() => emit({ ...snapshot, loaded: true }));
  return loading;
}

/** Idempotent. The copy changes now; the server hears about it only when there is someone to teach. */
export function learn(concept: Concept): void {
  if (snapshot.learned.includes(concept)) return;
  emit({ ...snapshot, learned: [...snapshot.learned, concept] });
  if (snapshot.eligible) void api.guideLearned(concept).catch(() => {});
}

/**
 * Start the tours over, asked for from the help menu. Every tour is forgotten
 * and the install is taught again, whoever it was; the welcome stays answered
 * and the refine row, which is not a tour, stays learned.
 */
export function restartTours(): void {
  emit({
    eligible: true,
    learned: snapshot.learned.includes('refine') ? ['welcome', 'refine'] : ['welcome'],
    loaded: true,
    optedIn: true,
  });
  void api.guideRestart().catch(() => {});
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
  listeners.clear();
}
