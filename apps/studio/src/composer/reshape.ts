/**
 * The op the composer preselects when a target shape differs from the shot's.
 *
 * A deliberate duplicate of `packages/cli/src/cropRules.ts` — the same
 * tolerated drift as FORMATS (see formats.ts): drifting here only
 * mis-preselects a default, never changes what the server executes, because
 * the request always carries the user's explicit choice.
 *
 * The mapping is the user's, not a ratio-sign rule: a MORE directional target
 * (1:1 to 16:9, 1:1 to 9:16) reads as "give the picture a wider stage" and
 * extends; a SQUARER one (16:9 to 1:1) reads as "tighten onto what is there"
 * and crops. That is a comparison of |log ratio|; the equally-directional tie
 * (16:9 to 9:16) defaults to extend, the op that keeps every pixel.
 */
export function defaultReshapeOp(sourceRatio: number, targetRatio: number): 'extend' | 'crop' {
  if (!(sourceRatio > 0 && targetRatio > 0)) return 'extend';
  return Math.abs(Math.log(targetRatio)) < Math.abs(Math.log(sourceRatio)) - 0.01 ? 'crop' : 'extend';
}
