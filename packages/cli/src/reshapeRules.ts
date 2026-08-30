/**
 * The one classifier for a reshape, and the fit that keeps it drawable.
 *
 * Before this file the decision lived in the browser (composer/reshape.ts
 * preselects an op from nominal format ratios) and the server executed
 * whatever arrived — an absent op always meant extend, growth was unbounded,
 * and the planned frame could exceed what the engine can draw. The measured
 * consequence (node d2aef33c, 2026-08-30): a 1122x1402 shot asked for 16:9
 * planned a 2496x1402 frame, 2.2x codex's 1.57-megapixel budget, and the
 * engine's native answer was upscaled 1.49x to fill it. Every over-budget
 * extend shipped that way.
 *
 * Two pure functions fix the two halves. `classifyReshape` owns crop versus
 * extend versus nothing, honouring an explicit ask when the geometry can and
 * refusing it plainly when it cannot. `fitExpandToBudget` scales a planned
 * frame down to the engine's own pixel count — the source steps down once,
 * uniformly, by our lanczos, and nothing on the path is ever upscaled.
 */
import { budgetSize } from '@scenri/core';
import { defaultReshapeOp } from './cropRules.js';
import type { ExpandPlan } from './expandRules.js';
import { CROP_ASSIST_ABOVE, cropAssistWindow, type GrowthPlan, planGrowth } from './outpaint/growth.js';

/**
 * The most one extend may grow its axis, after crop assist. Past this the
 * engine is asked to invent more of the photograph than it keeps, which the
 * 2026-08-26 battery put well outside the reliable band — 16:9 to 9:16 is a
 * 3.16x ask and the reason this bound exists. It deliberately sits above
 * SINGLE_PASS_MAX (1.5): the flagship reshapes 1:1 to 16:9 and 1:1 to 9:16
 * are 1.78x, were measured acceptable across the whole battery, and staged
 * growth (the thing SINGLE_PASS_MAX budgets for) is not built.
 */
export const EXTEND_MAX = CROP_ASSIST_ABOVE;

export type ReshapeDecision =
  | { op: 'none' }
  | { op: 'crop'; forced: boolean; growth?: GrowthPlan }
  | { op: 'extend'; growth: GrowthPlan; assist: { left: number; top: number; width: number; height: number } | null };

/**
 * Decide what a reshape to `targetRatio` actually is.
 *
 * `requested` is the caller's hint, never the authority: an explicit crop is
 * always honoured (any ratio is reachable by cutting one axis), an explicit
 * extend is honoured only inside EXTEND_MAX, and an absent op falls to the
 * user mapping in `defaultReshapeOp` — squarer crops, more directional
 * extends. A forced crop (`forced: true`) means the geometry refused the
 * extend, and the caller says so rather than doing it quietly.
 */
export function classifyReshape(
  source: { width: number; height: number },
  targetRatio: number,
  requested?: 'crop' | 'extend',
): ReshapeDecision {
  if (!(source.width > 0 && source.height > 0 && targetRatio > 0)) return { op: 'none' };
  const growth = planGrowth(source, targetRatio);
  // planGrowth's null is the shared 1% same-shape tolerance.
  if (!growth) return { op: 'none' };
  const op = requested ?? defaultReshapeOp(source.width / source.height, targetRatio);
  if (op === 'crop') return { op: 'crop', forced: false };
  if (growth.effective > EXTEND_MAX + 1e-9) return { op: 'crop', forced: true, growth };
  return { op: 'extend', growth, assist: cropAssistWindow(source, growth) };
}

export interface ExpandFit {
  /** The frame to actually ask for. Unchanged when scale is 1. */
  plan: ExpandPlan;
  /** The size the source is sent at. Unchanged when scale is 1. */
  source: { width: number; height: number };
  /** Linear factor applied to everything; 1 means the budget already fit. */
  scale: number;
}

/**
 * Fit a planned frame to what the engine can draw.
 *
 * The whole geometry scales together — frame, source and offset — so the
 * margins and the centre share one texture scale and the assembly's
 * exact-size branch fires instead of its rescale. The axis that did not grow
 * is locked to the frame edge exactly, preserving planExpand's "keep every
 * row" invariant after the scale, so no one-pixel generated strip appears on
 * an edge the picture already owns.
 */
export function fitExpandToBudget(
  plan: ExpandPlan,
  source: { width: number; height: number },
  pixelBudget: number | undefined,
): ExpandFit {
  if (!pixelBudget || plan.width * plan.height <= pixelBudget) return { plan, source, scale: 1 };
  const frame = budgetSize(plan.width, plan.height, pixelBudget);
  if (plan.axis === 'width') {
    const scale = frame.height / plan.height;
    const width = Math.min(frame.width, Math.max(1, Math.round(source.width * scale)));
    const left = Math.min(Math.max(0, Math.round(plan.left * scale)), frame.width - width);
    return {
      plan: { width: frame.width, height: frame.height, left, top: 0, axis: 'width' },
      source: { width, height: frame.height },
      scale,
    };
  }
  const scale = frame.width / plan.width;
  const height = Math.min(frame.height, Math.max(1, Math.round(source.height * scale)));
  const top = Math.min(Math.max(0, Math.round(plan.top * scale)), frame.height - height);
  return {
    plan: { width: frame.width, height: frame.height, left: 0, top, axis: 'height' },
    source: { width: frame.width, height },
    scale,
  };
}

/**
 * The op alone, from ratios alone — what a pre-send hint needs.
 *
 * `apps/studio/src/composer/reshape.ts` carries a deliberate dependency-free
 * twin of this (the same arrangement as defaultReshapeOp); the two are pinned
 * to the same answer table by tests on both sides.
 */
export function reshapeOpFor(sourceRatio: number, targetRatio: number): 'extend' | 'crop' {
  const decision = classifyReshape({ width: sourceRatio, height: 1 }, targetRatio);
  return decision.op === 'crop' ? 'crop' : 'extend';
}
