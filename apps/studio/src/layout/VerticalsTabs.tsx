import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';

export interface VerticalsTabItem {
  /** `null` is the "all / every" clear option. */
  value: string | null;
  label: string;
  count: number;
}

function isSelected(activeKey: string | null, value: string | null): boolean {
  return value === null ? activeKey === null : activeKey === value;
}

/**
 * Category / facet rail — one scrollport, pinned edge fades, sliding ink.
 * Kept lean for touch: no scroll-snap, no per-frame ink work.
 * Grid updates instantly (no view-transition) so filtered images don't blink.
 */
export function VerticalsTabs({
  'aria-label': ariaLabel,
  activeKey,
  items,
  onSelect,
}: {
  'aria-label': string;
  activeKey: string | null;
  items: VerticalsTabItem[];
  onSelect: (value: string | null) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const itemsKey = items.map((i) => `${i.value ?? ''}:${i.count}`).join('|');

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const rail = railRef.current;
    if (!shell || !rail) return;

    let fadeRaf = 0;

    const placeInk = () => {
      const on = rail.querySelector<HTMLElement>(':scope > button[data-on]');
      if (!on) {
        rail.style.setProperty('--sc-ink-x', '0px');
        rail.style.setProperty('--sc-ink-w', '0px');
        return null;
      }
      const label = on.querySelector<HTMLElement>('.sc-vlabel') ?? on;
      rail.style.setProperty('--sc-ink-x', `${on.offsetLeft + label.offsetLeft}px`);
      rail.style.setProperty('--sc-ink-w', `${label.offsetWidth}px`);
      return on;
    };

    const placeFades = () => {
      const max = rail.scrollWidth - rail.clientWidth;
      if (max <= 1) {
        delete shell.dataset.overflowLeft;
        delete shell.dataset.overflowRight;
        return;
      }
      if (rail.scrollLeft > 2) shell.dataset.overflowLeft = '';
      else delete shell.dataset.overflowLeft;
      if (rail.scrollLeft < max - 2) shell.dataset.overflowRight = '';
      else delete shell.dataset.overflowRight;
    };

    /**
     * Free pan always. On select, if the following (or previous) tab is
     * hidden, nudge just enough for it to peek in — not a full re-center.
     */
    const revealActive = (on: HTMLElement) => {
      const max = rail.scrollWidth - rail.clientWidth;
      if (max <= 0) return;

      const buttons = [...rail.querySelectorAll<HTMLElement>(':scope > button')];
      const i = buttons.indexOf(on);
      if (i < 0) return;

      const peek = 72;
      const viewLeft = rail.scrollLeft;
      const viewRight = viewLeft + rail.clientWidth;
      const prev = buttons[i - 1];
      const nextBtn = buttons[i + 1];

      // Prefer showing a slice of the next tab; fall back to previous.
      const wantRight = nextBtn
        ? nextBtn.offsetLeft + Math.min(peek, nextBtn.offsetWidth)
        : on.offsetLeft + on.offsetWidth + 8;
      const wantLeft = prev ? Math.max(0, prev.offsetLeft + prev.offsetWidth - peek) : Math.max(0, on.offsetLeft - 8);

      let next = viewLeft;
      if (wantRight > viewRight) next = Math.min(max, wantRight - rail.clientWidth);
      else if (wantLeft < viewLeft) next = wantLeft;
      else return;

      if (Math.abs(next - viewLeft) < 1) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      rail.scrollTo({ left: next, behavior: reduce ? 'auto' : 'smooth' });
    };

    const on = placeInk();
    if (on) revealActive(on);
    placeFades();
    if (!rail.dataset.inkReady) {
      requestAnimationFrame(() => {
        rail.dataset.inkReady = '';
      });
    }

    const onScroll = () => {
      if (fadeRaf) return;
      fadeRaf = requestAnimationFrame(() => {
        fadeRaf = 0;
        placeFades();
      });
    };

    const onWheel = (e: WheelEvent) => {
      if (rail.scrollWidth <= rail.clientWidth + 1) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.deltaY === 0) return;
      const max = rail.scrollWidth - rail.clientWidth;
      const next = Math.max(0, Math.min(max, rail.scrollLeft + e.deltaY));
      if (next === rail.scrollLeft) return;
      e.preventDefault();
      rail.scrollLeft = next;
      placeFades();
    };

    const ro = new ResizeObserver(() => {
      placeInk();
      placeFades();
    });
    ro.observe(rail);

    rail.addEventListener('scroll', onScroll, { passive: true });
    rail.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      if (fadeRaf) cancelAnimationFrame(fadeRaf);
      ro.disconnect();
      rail.removeEventListener('scroll', onScroll);
      rail.removeEventListener('wheel', onWheel);
    };
  }, [activeKey, itemsKey]);

  const select = (value: string | null) => {
    if (isSelected(activeKey, value)) return;
    onSelect(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    if (items.length === 0) return;
    e.preventDefault();
    const i = Math.max(
      0,
      items.findIndex((item) => isSelected(activeKey, item.value)),
    );
    let next = i;
    if (e.key === 'ArrowRight') next = Math.min(items.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next === i) return;
    select(items[next]!.value);
    const btn = railRef.current?.querySelectorAll(':scope > button')[next] as HTMLButtonElement | undefined;
    btn?.focus();
  };

  return (
    <div ref={shellRef} className="sc-verticals-shell">
      <div ref={railRef} className="sc-verticals" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
        <span className="sc-verticals-ink" aria-hidden />
        {items.map((item) => {
          const on = isSelected(activeKey, item.value);
          return (
            <button
              key={item.value ?? '__all__'}
              type="button"
              role="tab"
              aria-selected={on}
              data-on={on ? '' : undefined}
              tabIndex={on ? 0 : -1}
              onClick={() => select(item.value)}
            >
              <span className="sc-vlabel">{item.label}</span>
              <span className="sc-vcount">{item.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
