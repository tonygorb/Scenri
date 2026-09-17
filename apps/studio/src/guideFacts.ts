import { useSyncExternalStore } from 'react';

/**
 * What the product says about itself, for the first-use guide to read
 * (DESIGN.md, "First use"). The guide never owns product state and never asks
 * the DOM what happened: Create's composer, the open shot's composer and the
 * presenter studio publish a small summary of where they are, only when it
 * changes.
 */
export interface ComposerFacts {
  brandId: string;
  /** Ingredients in the brief right now. */
  products: number;
  presenters: number;
  scene: boolean;
  /** Any other chip: a colour, an image, the brand mark, a shot. */
  others: number;
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
  /**
   * How the shot's settings are offered at this size: three controls in the
   * row, one More popover, or one sheet on a phone.
   */
  settings: 'pills' | 'more' | 'sheet';
  /** Which settings have been opened and answered (keeping the current value counts). */
  settled: { shape: boolean; count: boolean; quality: boolean };
  /** Which ingredients the library has any of to pick: one it has none of is never asked for. */
  offered: { product: boolean; presenter: boolean; scene: boolean };
}

export interface StudioFacts {
  /** The question the presenter studio is asking now, by its id. */
  open: string | null;
}

export interface OverlayFacts {
  /** The open shot's composer has been reached for: focus, or words in it. */
  engaged: boolean;
}

export interface GuideFacts {
  composer: ComposerFacts | null;
  overlay: OverlayFacts | null;
  studio: StudioFacts | null;
  /** Some first-use surface is on screen: What's New waits for it. */
  showing: boolean;
  /**
   * The first shot is on a step before Generate: a send from the brief (Enter)
   * would skip what the guide is asking for, so it is taken as saying the step
   * is done instead.
   */
  holdSend: boolean;
}

const EMPTY: GuideFacts = { composer: null, overlay: null, studio: null, showing: false, holdSend: false };
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

export function publishOverlay(facts: OverlayFacts | null): void {
  if (!same(state.overlay, facts)) set({ ...state, overlay: facts });
}

export function publishStudio(facts: StudioFacts | null): void {
  if (!same(state.studio, facts)) set({ ...state, studio: facts });
}

export function setGuideHoldSend(holdSend: boolean): void {
  if (state.holdSend !== holdSend) set({ ...state, holdSend });
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
