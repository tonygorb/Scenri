import { useSyncExternalStore } from 'react';

/**
 * What the product says about itself, for the first-use guide to read
 * (DESIGN.md, "First use"). The guide never owns product state and never asks
 * the DOM what happened: Create's composer and the presenter studio publish a
 * small summary of where they are, only when it changes, and surfaces register
 * the slots a one-line note can sit in.
 */
export interface ComposerFacts {
  brandId: string;
  /** Ingredients in the brief right now. */
  products: number;
  presenters: number;
  scene: boolean;
  /** The brief has words of its own. */
  words: boolean;
  /** Generate would run. */
  canGo: boolean;
  /** A send is on its way to the server. */
  busy: boolean;
  pickerOpen: boolean;
  /** The brief refines a shot rather than making a new one. */
  refining: boolean;
  /** Whether an engine can draw, and if not, which door the composer offers. */
  engine: 'ready' | 'setup' | 'settings';
}

export interface StudioFacts {
  /** The question the presenter studio is asking now, by its id. */
  open: string | null;
}

export interface GuideFacts {
  composer: ComposerFacts | null;
  studio: StudioFacts | null;
  slots: Readonly<Record<string, HTMLElement>>;
  /** Some first-use surface is on screen: What's New waits for it. */
  showing: boolean;
}

const EMPTY: GuideFacts = { composer: null, studio: null, slots: {}, showing: false };
let state: GuideFacts = EMPTY;
const listeners = new Set<() => void>();

function set(next: GuideFacts) {
  state = next;
  for (const l of listeners) l();
}

const same = (a: object | null, b: object | null) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function publishComposer(facts: ComposerFacts | null): void {
  if (!same(state.composer, facts)) set({ ...state, composer: facts });
}

export function publishStudio(facts: StudioFacts | null): void {
  if (!same(state.studio, facts)) set({ ...state, studio: facts });
}

/** A place a note can sit: the picker, the open shot's tray, a creation dialog, the studio. */
export function registerSlot(name: string, el: HTMLElement): void {
  if (state.slots[name] !== el) set({ ...state, slots: { ...state.slots, [name]: el } });
}

/** Lets go of a slot, only if it is still this element's: a newer one of the same name stays. */
export function releaseSlot(name: string, el: HTMLElement): void {
  if (state.slots[name] !== el) return;
  const slots = { ...state.slots };
  delete slots[name];
  set({ ...state, slots });
}

export function setGuideShowing(showing: boolean): void {
  if (state.showing !== showing) set({ ...state, showing });
}

export function subscribeGuideFacts(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function guideFactsSnapshot(): GuideFacts {
  return state;
}

export function useGuideFacts(): GuideFacts {
  return useSyncExternalStore(subscribeGuideFacts, guideFactsSnapshot);
}

export function useGuideShowing(): boolean {
  return useSyncExternalStore(subscribeGuideFacts, () => state.showing);
}

/** Tests only: a fresh page. */
export function resetGuideFactsForTests(): void {
  state = EMPTY;
  listeners.clear();
}
