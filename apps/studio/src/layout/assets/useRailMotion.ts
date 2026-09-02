import { useLayoutEffect, useRef, type RefObject } from 'react';

/** --sc-dur-slow and --sc-ease-emphasis: something arriving or leaving. */
const DURATION_MS = 220;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

interface Box {
  group: HTMLElement;
  body: HTMLElement;
  height: number;
  marginBottom: number;
}

function measure(rail: HTMLElement): Box[] {
  const boxes: Box[] = [];
  for (const group of rail.querySelectorAll<HTMLElement>('.sc-agroup')) {
    const body = group.querySelector<HTMLElement>(':scope > .sc-agroup-body');
    if (!body) continue;
    boxes.push({
      group,
      body,
      height: body.getBoundingClientRect().height,
      marginBottom: Number.parseFloat(getComputedStyle(group).marginBottom) || 0,
    });
  }
  return boxes;
}

/**
 * Every section of the rail moves on one clock.
 *
 * Opening a section is one event in four places: it grows, its siblings fold
 * to their headings, and the gaps between them close. Left to CSS
 * transitions, each of those ran its own timer — the grid-row collapse on
 * one, the margins on another, and the open section's height on none, since
 * a flex box filling whatever is left has no start value to ease from. So
 * the open section snapped while the rest were still moving.
 *
 * This is the FLIP pattern instead: `snapshot()` reads every body's height
 * and every group's margin the instant before the state changes; after the
 * commit, the same boxes are read again in their final layout, and each one
 * that changed is animated from the old number to the new by the Web
 * Animations API, all with the same duration and curve. The final layout is
 * whatever flex decides, measured once, so nothing lands short and jumps at
 * the end. Overflow is clipped while a box is in flight so a section that
 * will scroll does not flash its scrollbar on the way.
 *
 * `key` is the state the caller changes after a snapshot; the effect runs
 * on its commit. A snapshot nobody followed with a change is simply dropped
 * on the next one. Reduced motion takes no snapshot, so nothing animates.
 */
export function useRailMotion(rail: RefObject<HTMLElement | null>, key: unknown): () => void {
  const before = useRef<Box[] | null>(null);

  const snapshot = () => {
    const el = rail.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Anything still in flight is run to its end first, so the reading is
    // the true resting layout and a quick second click starts from where
    // the first one would have finished.
    for (const box of measure(el)) {
      for (const a of [...box.body.getAnimations(), ...box.group.getAnimations()]) a.finish();
    }
    before.current = measure(el);
  };

  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    const el = rail.current;
    if (!was || !el) return;
    for (const box of measure(el)) {
      const prev = was.find((b) => b.group === box.group);
      if (!prev) continue;
      if (Math.abs(prev.height - box.height) > 0.5) {
        const { body } = box;
        body.style.overflow = 'hidden';
        const anim = body.animate([{ height: `${prev.height}px` }, { height: `${box.height}px` }], {
          duration: DURATION_MS,
          easing: EASE,
        });
        const release = () => {
          body.style.overflow = '';
        };
        anim.onfinish = release;
        anim.oncancel = release;
      }
      if (Math.abs(prev.marginBottom - box.marginBottom) > 0.5) {
        box.group.animate([{ marginBottom: `${prev.marginBottom}px` }, { marginBottom: `${box.marginBottom}px` }], {
          duration: DURATION_MS,
          easing: EASE,
        });
      }
    }
  }, [key]);

  return snapshot;
}
