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
 * on load is not forty pieces of news.
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
  const next = new Map<string, string>();
  const messages: string[] = [];
  for (const n of nodes) {
    next.set(n.id, n.status);
    const was = prev.get(n.id);
    if (was === n.status) continue;
    if (was === undefined) {
      // brand new to this session: only "running" is news
      if (n.status === 'running') messages.push('Generating shot.');
      continue;
    }
    if (n.status === 'done') {
      messages.push(`Shot ready, ${n.images.length} image${n.images.length === 1 ? '' : 's'}.`);
    } else if (n.status === 'error') {
      messages.push(`Shot failed${n.error ? `: ${n.error}` : '.'}`);
    } else if (n.status === 'cancelled') {
      messages.push('Shot cancelled.');
    }
  }
  return { messages, next };
}
