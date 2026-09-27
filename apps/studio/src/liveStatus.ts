/**
 * What a screen reader is told about generation, and when.
 *
 * Completion is deliberately toast-silent for sighted users — the tile
 * appearing in the feed IS the signal — which left assistive technology with
 * nothing at all: a shot could start, land or fail and the only trace was a
 * button label somewhere in the grid. This diffs the statuses between two
 * reads of the tree and yields one short sentence per real transition.
 *
 * Only transitions speak. An unchanged status never repeats itself, and the
 * caller skips the very first diff — a feed of forty finished shots arriving
 * on load is not forty pieces of news. A batch speaks once ("Generating 4
 * shots."), not once per sibling.
 *
 * The statuses are merged, never replaced: the caller hands in whatever it
 * just heard, sometimes the whole poll and sometimes the one to four records
 * a send or a keep returned, and a map rebuilt from the small answer forgot
 * every other shot, so the next poll took them for new and stayed silent when
 * they landed.
 */
export interface NodeStatusLite {
  id: string;
  status: string;
  images: string[];
  error?: string | null;
}

export function generationMessages(
  prev: ReadonlyMap<string, string>,
  nodes: NodeStatusLite[],
): { messages: string[]; next: Map<string, string> } {
  const next = new Map(prev);
  let started = 0;
  let ready = 0;
  let cancelled = 0;
  const failed: (string | null | undefined)[] = [];
  for (const n of nodes) {
    next.set(n.id, n.status);
    const was = prev.get(n.id);
    if (was === n.status) continue;
    if (was === undefined) {
      // brand new to this session: only "running" is news
      if (n.status === 'running') started += 1;
      continue;
    }
    // a node is one image now; the count-of-images sentence died with takes
    if (n.status === 'done') ready += 1;
    else if (n.status === 'error') failed.push(n.error);
    else if (n.status === 'cancelled') cancelled += 1;
  }
  const messages: string[] = [];
  if (started) messages.push(started === 1 ? 'Generating shot.' : `Generating ${started} shots.`);
  if (ready) messages.push(ready === 1 ? 'Shot ready.' : `${ready} shots ready.`);
  if (failed.length === 1) messages.push(`Shot failed${failed[0] ? `: ${failed[0]}` : '.'}`);
  else if (failed.length) messages.push(`${failed.length} shots failed.`);
  if (cancelled) messages.push(cancelled === 1 ? 'Shot cancelled.' : `${cancelled} shots cancelled.`);
  return { messages, next };
}
