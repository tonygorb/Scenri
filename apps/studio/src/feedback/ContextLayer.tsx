import { Bug } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Right-click, anywhere, as the way in.
 *
 * A page cannot add an item to the browser's own menu, only replace it, so
 * this stands down wherever the native menu carries something that cannot be
 * reproduced: the caret, paste, spellcheck.
 *
 * It offers one thing and nothing else. Copy and save an image were here for a
 * while, on the theory that replacing the native menu owed them back — but the
 * feed's shot tiles already override native with their own menu, so that debt
 * was never owed, and the app has first-class download and export actions
 * anyway. In a menu about reporting, they read as part of the report.
 *
 * It also stands down when another handler already claimed the event. The two
 * Radix ContextMenus in Canvas.tsx and CatalogCard.tsx call preventDefault, so
 * `defaultPrevented` is how the richer, more specific menu keeps winning on
 * the surfaces that have one.
 */

/** Where the caret, a selection or a spellchecker means native must survive. */
export function nativeMenuMatters(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  if (el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return true;
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
}

interface Props {
  x: number;
  y: number;
  target: Element;
  onReport: (el: Element) => void;
  onClose: () => void;
}

export function ContextLayer({ x, y, target, onReport, onClose }: Props) {
  const [pos, setPos] = useState({ left: x, top: y });
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: Math.min(x, window.innerWidth - w - 8),
      top: Math.min(y, window.innerHeight - h - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Capture, so a click closes this before it reaches whatever is beneath —
    // but a click on the menu's own items has to survive, and stopPropagation
    // in the bubble phase cannot cancel a capture listener that already ran.
    const onDown = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onDown, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="sc-menu sc-fb-menu"
      data-fb-ui=""
      role="menu"
      aria-label="Report"
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 99 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        className="sc-menu-item"
        onClick={() => {
          onClose();
          onReport(target);
        }}
      >
        <Bug size={18} className="sc-menu-ic" />
        <span className="sc-menu-lb">Report this</span>
      </button>
    </div>,
    document.body,
  );
}
