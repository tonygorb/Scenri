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
  /** 0 for the original; a refinement's number, counted in the order they were made. */
  index: number;
  /** What the tile is called: "Original", "Refinement 3". */
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

/**
 * The steps of the trail the shot on the stage belongs to.
 *
 * `base` is the server's history for the shot (or, from a server without
 * one, the ancestors, the shot and its first refinements). `items` are the
 * feed's pages: a refinement queued a moment ago is already there, folded in
 * by its parent before the history has been asked again. The shot on the
 * stage is always a step, picture or not, so the ring never has nowhere to
 * be while a refinement renders or after it fails; any other step without a
 * picture stays out, a failed refinement being a card in the feed rather
 * than a hole in the row.
 */
export function trailOf(base: FeedNode[], node: FeedNode, items: FeedNode[]): TrailStep[] {
  const ids = new Set(base.map((n) => n.id));
  const fresh = items.filter((n) => !ids.has(n.id) && n.parentId !== null && ids.has(n.parentId));
  const all = fresh.length ? [...base, ...fresh].sort(byMade) : base;
  const withSelf = all.some((n) => n.id === node.id) ? all : [...all, node];
  const shown = withSelf
    // the record on screen is the freshest copy of itself
    .map((n) => (n.id === node.id ? node : n))
    .filter((n) => n.id === node.id || n.images[0]);

  // Numbers count refinements only: an original is not "Refinement 0", and
  // a row that has lost its original (archived, so out of the history) does
  // not promote the first refinement to one.
  let made = 0;
  const steps = shown.map((n): TrailStep => {
    const index = n.kind === 'edit' ? ++made : 0;
    return {
      node: n,
      index,
      label: stepLabel(index),
      from: null,
      state: n.images[0] ? 'ready' : n.status === 'running' ? 'pending' : 'failed',
    };
  });
  const at = new Map(steps.map((s, i) => [s.node.id, i]));
  return steps.map((s, i) => {
    if (i === 0 || !s.node.parentId || s.node.parentId === steps[i - 1].node.id) return s;
    const parent = at.get(s.node.parentId);
    return parent === undefined ? s : { ...s, from: spokenOf(steps[parent].index) };
  });
}
