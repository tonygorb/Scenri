import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/**
 * Where each history entry was scrolled to.
 *
 * A module-level Map rather than sessionStorage: this is about Back inside a
 * session. A reload rebuilds every pane from a cold catalog, and the browser
 * has nothing to restore an inner div to anyway.
 */
const offsets = new Map<string, number>();
/** Places remembered. A Map keeps insertion order, so the oldest key is the first one. */
const OFFSETS_CAP = 50;
function remember(key: string, top: number): void {
  offsets.delete(key);
  remember(key, top);
  while (offsets.size > OFFSETS_CAP) offsets.delete(offsets.keys().next().value as string);
}

/** How long a pane keeps waiting for late content before it settles for what it has. */
const SETTLE_MS = 1000;

/**
 * The scrolling pane a browse screen lives in, which remembers where you left it.
 *
 * `<ScrollRestoration />` in AppShell cannot do this job here: it restores the
 * *window*, and inside a brand the window never scrolls — `.sc-shell` is a
 * fixed 100dvh grid with `overflow: hidden`, so every screen scrolls in its own
 * `.sc-home`. The offset it saves is therefore always 0. (It stays mounted for
 * /setup, which is outside the shell and does scroll the window.)
 *
 * Keyed on `location.key` rather than the path: a fresh visit gets a new key,
 * so arriving somewhere for the first time starts at the top by construction,
 * and only Back or Forward can land on an entry that has an offset. Filters
 * navigate with `replace`, which also mints a key, so changing one does not
 * inherit the position of the list before it.
 */
export function ScrollPane({ className = 'sc-home', children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { key } = useLocation();
  /** True while the restore below is still chasing its offset — see `save`. */
  const chasing = useRef(false);

  // before paint, so a restored pane never shows its top edge first
  useLayoutEffect(() => {
    const el = ref.current;
    const target = offsets.get(key);
    if (!el || !target) return;

    /**
     * A detail page comes back shorter than it left: its reference frames are
     * fetched per id, so the first paint is one preview tall and the browser
     * clamps the assignment to whatever fits. So the offset is re-applied as
     * the content arrives — watching the pane and the page inside it — rather
     * than once on mount, and it gives up after a beat so a page that never
     * grows back doesn't keep a listener alive for it.
     */
    let settled = false;
    const stop = () => {
      if (settled) return;
      settled = true;
      chasing.current = false;
      observer.disconnect();
      clearTimeout(timer);
      el.removeEventListener('wheel', stop);
      el.removeEventListener('touchstart', stop);
    };
    const apply = () => {
      if (settled) return;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) < 1) stop();
    };

    chasing.current = true;
    const observer = new ResizeObserver(apply);
    const timer = setTimeout(stop, SETTLE_MS);
    // a pane that is still growing under you is not a pane you want to fight
    el.addEventListener('wheel', stop, { passive: true });
    el.addEventListener('touchstart', stop, { passive: true });

    apply();
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);

    return stop;
  }, [key]);

  // Saved as you scroll, not on the way out: an effect cleanup runs after React
  // has already detached the node, and a detached node reports scrollTop 0.
  // Anything the restore itself lands on is skipped, or a clamped first attempt
  // would overwrite the very offset it is trying to reach.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const save = () => {
      if (!chasing.current) remember(key, el.scrollTop);
    };
    el.addEventListener('scroll', save, { passive: true });
    return () => el.removeEventListener('scroll', save);
  }, [key]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
