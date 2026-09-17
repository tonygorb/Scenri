/**
 * The coach's hold on the page: everything but the card and the step's own
 * surface is made `inert`, so it takes no pointer, no Tab and no screen reader
 * cursor, and the real control under the window works as it always does.
 *
 * The walk is aria-hidden's: keep every ancestor of what must stay live, and
 * inert each sibling branch along the way. It is written here rather than
 * borrowed because aria-hidden's counters are shared with Radix, which hides
 * the page the same way whenever a dialog opens; a coach paused under a dialog
 * would then leave parts of the page inert after both had gone. This lock
 * marks what it touches and only ever undoes its own marks, and it never
 * touches a node something else already made inert.
 */
export const LOCK_MARK = 'data-sc-coach-inert';

const NEVER = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);

export interface CoachLock {
  /** Hold everything except these elements (and their ancestors). Idempotent; only changes what differs. */
  set(keep: readonly Element[]): void;
  release(): void;
}

export function createLock(root: Element = document.body): CoachLock {
  let marked = new Set<Element>();

  const mark = (el: Element) => {
    if (el.hasAttribute('inert') && !el.hasAttribute(LOCK_MARK)) return;
    el.setAttribute(LOCK_MARK, '');
    el.setAttribute('inert', '');
  };
  const unmark = (el: Element) => {
    if (!el.hasAttribute(LOCK_MARK)) return;
    el.removeAttribute(LOCK_MARK);
    el.removeAttribute('inert');
  };

  return {
    set(keep) {
      const kept = new Set(keep.filter((el) => el.isConnected && root.contains(el) && el !== root));
      const path = new Set<Element>();
      for (const el of kept) {
        for (let n = el.parentElement; n && n !== root; n = n.parentElement) path.add(n);
      }
      const next = new Set<Element>();
      const walk = (parent: Element) => {
        for (const child of Array.from(parent.children)) {
          if (kept.has(child) || NEVER.has(child.tagName)) continue;
          if (path.has(child)) walk(child);
          else next.add(child);
        }
      };
      walk(root);
      for (const el of marked) if (!next.has(el)) unmark(el);
      for (const el of next) if (!marked.has(el)) mark(el);
      marked = new Set([...next].filter((el) => el.hasAttribute(LOCK_MARK)));
    },
    release() {
      for (const el of marked) unmark(el);
      marked = new Set();
    },
  };
}
