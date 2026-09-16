/**
 * The refine row: the one first-use sentence that is not a tour (DESIGN.md,
 * "First use"). Once a finished shot is on the hub, the composer says how to
 * change it the next time its brief takes focus. Pure, so every condition can
 * be proven on its own; the composer gathers values it already holds.
 */
export type Hint = 'refine';

export interface HintInput {
  /** The install was new when it first booted a build with guidance. */
  eligible: boolean;
  learned: readonly string[];
  /** The composer inside an open shot. */
  overlay: boolean;
  /** The brief is a refinement of a shot rather than a new one. */
  refining: boolean;
  /** At least one engine can generate; otherwise the engine banner owns the tray. */
  engineReady: boolean;
  /** The brief has had focus since this composer mounted. */
  engaged: boolean;
  attachOpen: boolean;
  /** The screen holds a finished shot a person could open (Create passes it; elsewhere false). */
  refineHint: boolean;
  /** A page tour is on screen: one voice at a time. */
  touring: boolean;
}

export function hintFor(i: HintInput): Hint | null {
  if (!i.eligible || i.overlay || i.refining || !i.engineReady || !i.engaged || i.attachOpen || i.touring) return null;
  return !i.learned.includes('refine') && i.refineHint ? 'refine' : null;
}

export const REFINE_HINT = 'To refine a shot, open it and say what to change.';
