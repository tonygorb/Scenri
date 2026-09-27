import type { FeedNode } from '../api.js';
import { byNewest } from '../feedRules.js';

/** How many of the newest done shots the workspace answer carries for the rail and the attach panel. */
const RECENT_CAP = 48;

/**
 * The recent shelf after a poll: records it holds are swapped in by id, a
 * shot that has just finished joins at its place, the shelf stays newest
 * first and never longer than the cap. The same array comes back when
 * nothing on it changed, so nothing downstream re-renders.
 */
export function mergeRecent(prev: FeedNode[], fresh: FeedNode[], cap = RECENT_CAP): FeedNode[] {
  let next: FeedNode[] | null = null;
  for (const n of fresh) {
    if (n.kind === 'root') continue;
    const i = (next ?? prev).findIndex((x) => x.id === n.id);
    const shows = n.status === 'done' && n.images.length > 0 && !n.archived;
    if (i >= 0) {
      const held = (next ?? prev)[i];
      // By reference, not by value, for now: a record re-read by a poll is a
      // new object, so the brand's shelf changes on every poll that carries
      // one, and the presenter questionnaire relies on that. Compared by value
      // (0.20.0 main, c90551f7), a trait taken away there left its answers
      // standing until something else re-rendered it (create-presenter-edits
      // B). Compare by value again once the questionnaire drops them itself.
      if (held === n) continue;
      next ??= [...prev];
      if (shows) next[i] = n;
      else next.splice(i, 1);
      continue;
    }
    if (!shows) continue;
    const list = next ?? prev;
    // only a shot newer than the shelf's oldest belongs on it; older ones are history, not recent
    if (list.length >= cap && byNewest(list[list.length - 1], n) < 0) continue;
    next ??= [...prev];
    let at = 0;
    while (at < next.length && byNewest(next[at], n) <= 0) at++;
    next.splice(at, 0, n);
    if (next.length > cap) next.length = cap;
  }
  return next ?? prev;
}
