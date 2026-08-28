/**
 * Browser storage, wrapped once.
 *
 * Every module that keeps something in the browser used to carry its own
 * three-line try/catch around getItem: draft.ts, createDraft.ts and tasks.ts
 * held byte-identical copies, down to the comment. Private-mode browsers throw
 * on the first touch, so the wrapping is not optional, and three copies of a
 * thing that is not optional is three chances to forget it.
 *
 * The lanes matter more than the wrapping. `local` outlives the browser and is
 * for a record, or for work someone means to come back to. `session` dies with
 * the tab, which is the right home for anything scoped to what a person is
 * doing right now — see UpdateCenter, where "not now" forever was the wrong
 * kind of quiet, and the create dialog's draft, where last week's photographs
 * turning up in a new form is the wrong kind of helpful.
 *
 * Picking the lane is the decision. Making it here, in one place with both
 * spelled out, is what keeps it a choice rather than whichever line got copied.
 *
 * No React import, same rule as every caller: vitest only globs `.ts` under test/.
 */

export interface SafeStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  del(key: string): void;
}

/**
 * Reached through a function rather than captured once: a browser that refuses
 * storage throws on the property itself, and a module-level read would take the
 * whole app down at import time rather than degrading to no draft.
 */
function lane(pick: () => Storage): SafeStorage {
  return {
    get(key) {
      try {
        return pick().getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        pick().setItem(key, value);
      } catch {
        /* what we keep here is nice to have, not worth an exception */
      }
    },
    del(key) {
      try {
        pick().removeItem(key);
      } catch {
        /* nothing to clean up if we cannot reach it anyway */
      }
    },
  };
}

/** Outlives the browser. A record, or work someone means to return to. */
export const local: SafeStorage = lane(() => localStorage);

/** Dies with the tab. Anything scoped to what a person is doing right now. */
export const session: SafeStorage = lane(() => sessionStorage);

/** A month-old unsent form is not a draft. Shared by both draft modules. */
export const STALE_MS = 30 * 24 * 60 * 60 * 1000;
