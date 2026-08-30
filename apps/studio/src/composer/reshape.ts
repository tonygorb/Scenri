/**
 * The op the composer preselects when a target shape differs from the shot's.
 *
 * A deliberate duplicate of the server's rule (`packages/cli/src/cropRules.ts`
 * plus the growth bound in `packages/cli/src/reshapeRules.ts`) — the same
 * tolerated drift as FORMATS (see formats.ts): drifting here only
 * mis-preselects a default, never changes what the server executes, because
 * the request always carries the user's explicit choice. Both copies are
 * pinned to one answer table by tests on each side.
 *
 * The mapping is the user's, not a ratio-sign rule: a MORE directional target
 * (1:1 to 16:9, 1:1 to 9:16) reads as "give the picture a wider stage" and
 * extends; a SQUARER one (16:9 to 1:1) reads as "tighten onto what is there"
 * and crops. That is a comparison of |log ratio|. The equally-directional tie
 * (16:9 to 9:16) used to default to extend; the growth bound below now sends
 * it to crop, because that extend is a 3.16x single-pass ask no engine on
 * this path can draw — the hint says "Will crop to" and tells the truth.
 */
export function defaultReshapeOp(sourceRatio: number, targetRatio: number): 'extend' | 'crop' {
  if (!(sourceRatio > 0 && targetRatio > 0)) return 'extend';
  return Math.abs(Math.log(targetRatio)) < Math.abs(Math.log(sourceRatio)) - 0.01 ? 'crop' : 'extend';
}

/** Mirrors CROP_ASSIST_ABOVE / CROP_ASSIST_MAX / EXTEND_MAX on the server. */
const EXTEND_MAX = 2;
const CROP_ASSIST_MAX = 0.15;

/**
 * The preselected op with the growth bound applied — what the hint shows and
 * what the request carries. An extend whose growth stays under EXTEND_MAX
 * after the server's capped crop assist is an extend; past that the geometry
 * refuses it and the honest op is a crop.
 */
export function reshapeOpFor(sourceRatio: number, targetRatio: number): 'extend' | 'crop' {
  if (defaultReshapeOp(sourceRatio, targetRatio) === 'crop') return 'crop';
  if (!(sourceRatio > 0 && targetRatio > 0)) return 'extend';
  const growth = targetRatio > sourceRatio ? targetRatio / sourceRatio : sourceRatio / targetRatio;
  const assisted = growth > EXTEND_MAX ? Math.max(EXTEND_MAX, growth * (1 - CROP_ASSIST_MAX)) : growth;
  return assisted > EXTEND_MAX + 1e-9 ? 'crop' : 'extend';
}
