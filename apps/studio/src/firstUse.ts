/**
 * Whether this build offers first-use guidance: the welcome, the tutor and
 * Learn (DESIGN.md, "First use").
 *
 * On. It stays a switch so guidance can be paused again without a revert: off,
 * the studio reads every install as one that is never taught, nothing opens by
 * itself, no task is in hand, and Help carries no way in. The server keeps its
 * record either way, so turning it back on loses nothing. The specs that walk
 * the guide skip while it is off (`e2e/harness.ts`).
 */
export const FIRST_USE = true;
