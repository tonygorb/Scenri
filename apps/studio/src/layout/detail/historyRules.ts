import type { FeedNode } from '../../api.js';

/**
 * The history of one image, read as a trail.
 *
 * The server answers with the root of the tree and every live descendant in
 * the order they were made. That is the right set and the right order, and
 * it says nothing about how to read it: which tile started the chain, which
 * number you are on, and whether a step was made from the one before it or
 * from somewhere further back. This turns the set into steps that say so.
 *
 * One row, chronological, whatever the tree's shape. Refining from an older
 * step makes a branch (a sibling of the steps after it), and the row stays a
 * row: the step keeps its place in time and names its source on its card
 * instead. A tree drawn under a photograph is a version manager, and this is
 * a creative tool.
 */

export type StepState = 'ready' | 'pending' | 'failed';

export interface TrailStep {
  node: FeedNode;
  /**
   * 0 for the original; a refinement's number, counted in the order they were
   * made over the steps that have a picture or have one coming; -1 for a step
   * that failed or was stopped, which has no number.
   */
  index: number;
  /** What the tile is called: "Original", "Refinement 3", "Did not finish". */
  label: string;
  /**
   * The step this one was made from, said only when it is not the tile
   * before it: "the original", "Refinement 1". Null along a chain, which is
   * the ordinary case and needs no words.
   */
  from: string | null;
  /** A picture, a picture still rendering, or a step that failed to make one. */
  state: StepState;
}

export const stepLabel = (index: number): string => (index === 0 ? 'Original' : `Refinement ${index}`);
const spokenOf = (index: number): string => (index === 0 ? 'the original' : `Refinement ${index}`);

/** Made first, first; a same-instant tie by id, so two readers agree. */
const byMade = (x: FeedNode, y: FeedNode) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id);

/** A step that did not make its picture says what happened instead of a number. */
const failedLabel = (n: FeedNode): string => (n.status === 'cancelled' ? 'Stopped' : 'Did not finish');

/**
 * The steps of the trail the shot on the stage belongs to.
 *
 * `base` is the server's history for the shot (or, from a server without
 * one, the ancestors, the shot and its first refinements). `items` are the
 * feed's pages and any record the overlay holds itself (a refinement queued
 * from it that the feed does not admit): a refinement queued a moment ago is
 * already there, folded in by its parent before the history has been asked
 * again, and a copy there is fresher than the history's, which was read
 * before it landed. The record on the stage is the freshest of all.
 *
 * Which steps are in the row: every step with a picture; every step still
 * being made, wherever the stage is, because a refinement renders as its own
 * tile beside the shot it came from while that shot stays on the stage; the
 * shot on the stage, picture or not; and a failed or stopped refinement of
 * the shot on the stage, so asking for one and having it fail is never a
 * silent nothing. Any other step without a picture stays out, a failure
 * being a card in the feed rather than a hole in the row.
 */
export function trailOf(base: FeedNode[], node: FeedNode, items: FeedNode[]): TrailStep[] {
  const ids = new Set(base.map((n) => n.id));
  // one copy per record, the last given winning: the same refinement can be
  // in the feed's pages and in the overlay's own hold at once
  const newer = new Map(items.map((n) => [n.id, n]));
  newer.set(node.id, node);
  const fresh = [...newer.values()].filter((n) => !ids.has(n.id) && n.parentId !== null && ids.has(n.parentId));
  const all = (fresh.length ? [...base, ...fresh].sort(byMade) : base).map((n) => newer.get(n.id) ?? n);
  const withSelf = all.some((n) => n.id === node.id) ? all : [...all, node];
  const shown = withSelf.filter(
    (n) =>
      n.id === node.id ||
      n.images[0] ||
      n.status === 'running' ||
      (n.parentId === node.id && (n.status === 'error' || n.status === 'cancelled')),
  );

  // Numbers count refinements only: an original is not "Refinement 0", and
  // a row that has lost its original (archived, so out of the history) does
  // not promote the first refinement to one. They count pictures, made or
  // coming, so a failed step, which is in the row only beside the step on
  // the stage, never shifts the numbers as the stage moves.
  let made = 0;
  const steps = shown.map((n): TrailStep => {
    const state: StepState = n.images[0] ? 'ready' : n.status === 'running' ? 'pending' : 'failed';
    if (state === 'failed' && n.kind === 'edit')
      return { node: n, index: -1, label: failedLabel(n), from: null, state };
    const index = n.kind === 'edit' ? ++made : 0;
    return { node: n, index, label: stepLabel(index), from: null, state };
  });
  const at = new Map(steps.map((s, i) => [s.node.id, i]));
  return steps.map((s, i) => {
    if (i === 0 || !s.node.parentId || s.node.parentId === steps[i - 1].node.id) return s;
    const parent = at.get(s.node.parentId);
    return parent === undefined || steps[parent].index < 0 ? s : { ...s, from: spokenOf(steps[parent].index) };
  });
}

/**
 * The refinement of the shot on the stage that is still being made, if any:
 * one at a time from the open shot, and it is this that holds the refine
 * field until it lands. Read off the trail, which comes from the server's
 * history, so it holds across closing and reopening the shot.
 */
export function pendingChildOf(trail: TrailStep[], stageId: string): FeedNode | null {
  return trail.find((s) => s.state === 'pending' && s.node.parentId === stageId)?.node ?? null;
}

/**
 * Where you are, in one line: "Original", or "Refinement 4 of 6". Empty when
 * the shot on the stage is not a step of the trail.
 */
export function whereIs(trail: TrailStep[], activeId: string): string {
  const here = trail.find((s) => s.node.id === activeId);
  if (!here) return '';
  if (here.index < 0) return here.label;
  const last = Math.max(0, ...trail.map((s) => s.index));
  return here.index === 0 ? 'Original' : `Refinement ${here.index} of ${last}`;
}
