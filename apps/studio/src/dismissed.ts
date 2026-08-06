/**
 * Permanently-failed and cancelled shots stay in the tree forever — there is
 * no delete-node endpoint, on purpose, since a shot is history. Dismissing
 * one only hides it from the feed and the Tasks tab, per brand, client-only.
 * Same shape as draft.ts's read/write and favorites.ts's per-id set.
 */

export const dismissedKey = (brandId: string): string => `scenri:dismissed-${brandId}`;

/** Private-mode browsers throw on localStorage; a missing record is not an error. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the dismiss-set is nice to have, not worth an exception */
  }
}

export function dismissedIds(brandId: string): string[] {
  const raw = read(dismissedKey(brandId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function isDismissed(brandId: string, nodeId: string): boolean {
  return dismissedIds(brandId).includes(nodeId);
}

export function dismissNode(brandId: string, nodeId: string): string[] {
  const cur = dismissedIds(brandId);
  if (cur.includes(nodeId)) return cur;
  const next = [...cur, nodeId];
  write(dismissedKey(brandId), JSON.stringify(next));
  return next;
}
