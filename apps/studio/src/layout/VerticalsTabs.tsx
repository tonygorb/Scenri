import { type ReactNode, useLayoutEffect, useRef } from 'react';

/**
 * Horizontal category tabs with a sliding underline ink.
 * Measures the `[data-on]` tab and drives `--sc-ink-x` / `--sc-ink-w` so the
 * mark glides between selections instead of popping per-button.
 */
export function VerticalsTabs({
  'aria-label': ariaLabel,
  activeKey,
  children,
}: {
  'aria-label': string;
  /** Remeasure when the selected tab changes. */
  activeKey: string | null;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const sync = () => {
      const on = root.querySelector<HTMLElement>(':scope > button[data-on]');
      if (!on) {
        root.style.setProperty('--sc-ink-x', '0px');
        root.style.setProperty('--sc-ink-w', '0px');
        return null;
      }
      // Ink tracks the label only — the superscript count sits outside the mark
      // so the underline doesn't leave a weird void under the raised numeral.
      const label = on.querySelector<HTMLElement>('.sc-vlabel') ?? on;
      root.style.setProperty('--sc-ink-x', `${on.offsetLeft + label.offsetLeft}px`);
      root.style.setProperty('--sc-ink-w', `${label.offsetWidth}px`);
      return on;
    };

    const on = sync();
    // Ease the active tab into view when it sits off-edge — nearest, no jump.
    if (on) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      on.scrollIntoView({
        inline: 'nearest',
        block: 'nearest',
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    }

    // Defer enabling transitions so the first place doesn't animate from 0.
    const ready = requestAnimationFrame(() => {
      root.dataset.inkReady = '';
    });

    const ro = new ResizeObserver(sync);
    ro.observe(root);
    for (const btn of root.querySelectorAll(':scope > button')) {
      ro.observe(btn);
      const label = btn.querySelector('.sc-vlabel');
      if (label) ro.observe(label);
    }
    root.addEventListener('scroll', sync, { passive: true });
    return () => {
      cancelAnimationFrame(ready);
      ro.disconnect();
      root.removeEventListener('scroll', sync);
    };
  }, [activeKey]);

  return (
    <div ref={rootRef} className="sc-verticals" role="tablist" aria-label={ariaLabel}>
      <span className="sc-verticals-ink" aria-hidden />
      {children}
    </div>
  );
}
