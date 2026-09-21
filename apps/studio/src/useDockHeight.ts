import { useLayoutEffect } from 'react';

/**
 * Publishes a docked composer's height on the root as a custom property, so the
 * toast stack can stand above the dock instead of over its buttons
 * (`styles/components/toasts.css`). Height only: where each dock sits is already
 * a stylesheet formula, and the toast rule repeats it, which keeps the keyboard,
 * the tab bar and the safe area in step without measuring any of them. Each dock
 * has its own property, so the open shot closing over Create leaves Create's.
 * Takes the element (a callback ref's state), so a dock that mounts later is seen.
 */
export function useDockHeight(el: HTMLElement | null, property: `--${string}`): void {
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const put = () => root.style.setProperty(property, `${Math.round(el.offsetHeight)}px`);
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty(property);
    };
  }, [el, property]);
}
