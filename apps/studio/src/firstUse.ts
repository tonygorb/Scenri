/**
 * Whether this build offers first-use guidance: the welcome, the tutor, First
 * steps and Learn (DESIGN.md, "First use").
 *
 * Paused while it is finished on its own branch. Off, the studio reads every
 * install as one that is never taught: nothing opens by itself, no task is in
 * hand, and Help carries no way in. The server keeps its record either way, so
 * turning this back on loses nothing. The specs that walk the guide skip while
 * it is off (`e2e/harness.ts`).
 */
export const FIRST_USE = false;
