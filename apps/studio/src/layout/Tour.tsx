import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { X } from '@phosphor-icons/react';
import { arrow, autoUpdate, computePosition, flip, offset, shift, type VirtualElement } from '@floating-ui/dom';
import { TOUR_KEEP_SELECTOR, type TourSide } from '../tours.js';
import { Tip } from './Tip.js';
import { createLock, type TourLock } from './tourLock.js';
import {
  boxOf,
  height,
  intersects,
  opposite,
  pad,
  panels,
  referenceRect,
  trimBy,
  union,
  visibleRect,
  width,
  windowMask,
  type Box,
} from './tourGeometry.js';

/** Air between a surface and the veil's window around it. */
const RING_PAD = 6;
/** From the target to the card's edge: the window's air, then room for the pointer. */
const GAP = 17;
const EDGE = 12;
/** The pointer keeps clear of the card's rounded corners. */
const ARROW_INSET = 20;
const SCROLL_WAIT_MS = 450;
/** Fixed and sticky chrome a window must not reach under. */
const CHROME = '.sc-topbar, .sc-tabbar, .sc-filterbar, .sc-canvas-dock, .sc-help-float';
/** The card fades out before it moves; it never slides across the page. Matches --sc-dur-fast. */
const FADE_MS = 120;

type Phase = 'moving' | 'shown' | 'stowed' | 'away';

/** What the card says, held while it fades so the words change only once it is out of sight. */
interface View {
  stopId: string;
  title: string;
  body: string;
  index: number;
  total: number;
  canBack: boolean;
  last: boolean;
}
const viewOf = (p: TourProps): View => ({
  stopId: p.stopId,
  title: p.title,
  body: p.body,
  index: p.index,
  total: p.total,
  canBack: p.canBack,
  last: p.last,
});

export interface TourProps {
  stopId: string;
  target: HTMLElement;
  /** The larger surface the stop is about, left open by the veil and never covered by the card. */
  region: HTMLElement | null;
  side: TourSide;
  index: number;
  total: number;
  title: string;
  body: string;
  canBack: boolean;
  last: boolean;
  onBack: (stopId: string) => void;
  onNext: (stopId: string) => void;
  onClose: (stopId: string) => void;
  /** The stop is on screen. `focusMoved` is true when the card took focus, which announces it already. Keep it stable. */
  onShown: (stopId: string, focusMoved: boolean) => void;
}

/**
 * One stop of a page tour (DESIGN.md, "First use"): a window in a curtain.
 *
 * The page behind goes dark and soft and holds still: it is inert, so it takes
 * no press, no Tab and no reader cursor. The stop's own surface shows through
 * the window sharp and fully working, because it is the real control and not a
 * picture of one. The card sits beside it, centred on the target and pointing
 * at it, and it never covers what it is about.
 *
 * It owns no product logic: TourHost decides which stop is showing and what
 * moves it; this draws it where the control actually is and holds the page
 * while it does.
 */
export function Tour(p: TourProps) {
  const { stopId, target, region, side, onShown } = p;
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const catchRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const pressed = useRef<'back' | 'next' | null>(null);
  const lock = useRef<TourLock | null>(null);
  const [phase, setPhase] = useState<Phase>('moving');
  const [masked] = useState(maskSupported);
  const [view, setView] = useState<View>(() => viewOf(p));
  const latest = useRef(p);
  latest.current = p;
  const everShown = useRef(false);
  const v = phase === 'shown' && view.stopId === stopId ? viewOf(p) : view;

  // One lock for the life of the tour on screen, released however it ends.
  useEffect(() => {
    lock.current = createLock();
    return () => {
      lock.current?.release();
      lock.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const pointer = arrowRef.current;
    const veil = veilRef.current;
    const catcher = catchRef.current;
    const ring = ringRef.current;
    if (!card || !pointer || !veil || !catcher || !ring) return;
    let alive = true;
    let token = 0;
    let frame = 0;
    let shown = false;
    let held = false;
    let stopAuto: (() => void) | null = null;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const surface = region ?? target;
    const radius = Number.parseFloat(getComputedStyle(surface).borderRadius) || 0;
    const pane = scrollPane(target);
    setPhase('moving');

    const hold = () =>
      lock.current?.set([card, veil, catcher, ring, surface, ...document.querySelectorAll(TOUR_KEEP_SELECTOR)]);

    // The target moved out of every pane (momentum, a resize): nothing is left
    // to point at, so the page is let go until it comes back.
    const away = () => {
      lock.current?.release();
      held = false;
      setPhase('away');
    };

    const update = async () => {
      const my = ++token;
      if (!target.isConnected || (region && !region.isConnected)) return away();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const vv = window.visualViewport;
      const clips: Box[] = [
        { left: 0, top: 0, right: vw, bottom: vh },
        ...(vv
          ? [
              {
                left: vv.offsetLeft,
                top: vv.offsetTop,
                right: vv.offsetLeft + vv.width,
                bottom: vv.offsetTop + vv.height,
              },
            ]
          : []),
        ...(pane ? [boxOf(pane.getBoundingClientRect())] : []),
      ];
      const chrome = occluders(surface);
      const seen = visibleRect(boxOf(target.getBoundingClientRect()), clips);
      const t = seen && trimBy(seen, chrome);
      if (!t) return away();
      const around = region ? visibleRect(boxOf(region.getBoundingClientRect()), clips) : null;
      const r = around && trimBy(around, chrome);
      // Held once per showing, and again whenever the page has redrawn the
      // target somewhere the hold does not reach (a bar swapped at a breakpoint).
      if (held && (target.closest('[inert]') || card.closest('[inert]'))) held = false;

      // The bars the page pins to its top and bottom are not room for the card.
      const room = {
        top: EDGE + barAbove(chrome, vh),
        bottom: EDGE + barBelow(chrome, vh),
        left: EDGE,
        right: EDGE,
      };
      const place = (ref: Box, fallbacks: TourSide[] | undefined) =>
        computePosition(virtual(ref, target), card, {
          strategy: 'fixed',
          placement: side,
          middleware: [
            offset(GAP),
            flip({ padding: room, fallbackPlacements: fallbacks }),
            shift({ padding: room }),
            arrow({ element: pointer, padding: ARROW_INSET }),
          ],
        });
      const covers = (x: number, y: number) =>
        intersects({ left: x, top: y, right: x + card.offsetWidth, bottom: y + card.offsetHeight }, pad(t, RING_PAD));
      // A card beside its target, on a screen too narrow for either side, goes below or above it instead.
      const sideways = side === 'left' || side === 'right';
      const fallbacks: TourSide[] | undefined = r
        ? [opposite(side)]
        : sideways
          ? [opposite(side), 'bottom', 'top']
          : undefined;

      let res = await place(referenceRect(t, r, side), fallbacks);
      if (!alive || my !== token) return;
      if (covers(res.x, res.y)) {
        res = await place(t, undefined);
        if (!alive || my !== token) return;
      }

      const open = pad(r ? union(t, r) : t, RING_PAD);
      paintVeil(veil, catcher, open, radius + RING_PAD, masked);
      if (region && region !== target) {
        const ringBox = pad(t, 3);
        Object.assign(ring.style, {
          left: `${ringBox.left}px`,
          top: `${ringBox.top}px`,
          width: `${width(ringBox)}px`,
          height: `${height(ringBox)}px`,
          borderRadius: `calc(${getComputedStyle(target).borderRadius} + 3px)`,
        });
        ring.hidden = false;
      } else ring.hidden = true;

      // On a small phone with the keyboard up there may be no room that leaves
      // the target clear. The card waits, out of the way, for the room to come back.
      if (covers(res.x, res.y)) return setPhase('stowed');

      const placed = res.placement.split('-')[0] as TourSide;
      card.style.left = `${Math.round(res.x)}px`;
      card.style.top = `${Math.round(res.y)}px`;
      card.dataset.side = placed;
      const a = res.middlewareData.arrow;
      pointer.dataset.edge = opposite(placed);
      pointer.style.left = a?.x != null ? `${a.x}px` : '';
      pointer.style.top = a?.y != null ? `${a.y}px` : '';
      pointer.hidden = !a || Math.abs(a.centerOffset) > 1;

      if (!held) {
        hold();
        held = true;
      }
      setPhase('shown');
      if (!shown) {
        shown = true;
        settle();
      }
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void update());
    };

    // The first time a stop is on screen: focus and the announcement.
    const settle = () => {
      everShown.current = true;
      let moved = false;
      if (pressed.current) {
        const again = pressed.current === 'back' ? backRef.current : null;
        (again ?? nextRef.current)?.focus({ preventScroll: true });
        pressed.current = null;
      } else {
        const active = document.activeElement;
        if (!active || active === document.body || !(card.contains(active) || surface.contains(active))) {
          card.focus({ preventScroll: true });
          moved = true;
        }
      }
      onShown(stopId, moved);
    };

    // Fade out what was showing, change the words, bring a stop below the fold
    // up once in its own pane, and only then place the card and fade it in.
    const fade = everShown.current && !still ? FADE_MS : 0;
    void wait(fade)
      .then(() => {
        if (!alive) return;
        flushSync(() => setView(viewOf(latest.current)));
        return bringIntoView(target, pane, still);
      })
      .then(() => {
        if (!alive) return;
        stopAuto = autoUpdate(virtual(boxOf(target.getBoundingClientRect()), target), card, schedule);
      });
    const ro = new ResizeObserver(schedule);
    if (region) ro.observe(region);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      stopAuto?.();
      ro.disconnect();
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [stopId, target, region, side, onShown, masked]);

  // The stop's words describe the control while it is the one being toured.
  useEffect(() => {
    if (!focusable(target)) return;
    const ids = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    if (ids.includes(bodyId)) return;
    target.setAttribute('aria-describedby', [...ids, bodyId].join(' '));
    return () => {
      const now = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && id !== bodyId);
      if (now.length) target.setAttribute('aria-describedby', now.join(' '));
      else target.removeAttribute('aria-describedby');
    };
  }, [target, bodyId]);

  // Keys belong to the tour and its surface only. Escape closes it; nothing
  // pressed on the card or the page behind reaches the page's own shortcuts.
  const { onClose } = p;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const card = cardRef.current;
      const surface = region ?? target;
      const from = e.target instanceof Node ? e.target : null;
      const inSurface = !!from && surface.contains(from);
      const active = document.activeElement;
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return;
        if (active?.closest('[role="dialog"]:not(.sc-tour)')) return;
        if (
          inSurface &&
          active?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]')
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        onClose(stopId);
        return;
      }
      if (inSurface) return;
      if (
        !from ||
        from === document.body ||
        from === document.documentElement ||
        card?.contains(from) ||
        catchRef.current?.contains(from)
      )
        e.stopPropagation();
    };
    // Focus that falls to nothing (a menu handing it back to a control the
    // tour has made inert) comes to the card rather than leaving the reader lost.
    // A press inside the stop's own surface is left to that surface.
    let frame = 0;
    let pressInSurface = false;
    const onDown = (e: PointerEvent) => {
      pressInSurface = e.target instanceof Node && (region ?? target).contains(e.target);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget || pressInSurface) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Tab past the last control leaves for the browser's own chrome: that is the reader's choice.
        if (!document.hasFocus()) return;
        const active = document.activeElement;
        if (!active || active === document.body || active.closest('[inert]'))
          cardRef.current?.focus({ preventScroll: true });
      });
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    document.addEventListener('focusout', onFocusOut, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('focusout', onFocusOut, true);
    };
  }, [stopId, target, region, onClose]);

  return createPortal(
    <>
      <div
        ref={veilRef}
        className="sc-tour-veil"
        data-veil={masked ? 'mask' : 'panels'}
        data-state={phase}
        aria-hidden="true"
      >
        {PARTS.map((i) => (
          <div key={i} className="sc-tour-panel" />
        ))}
      </div>
      <div
        ref={catchRef}
        className="sc-tour-catch"
        data-state={phase}
        aria-hidden="true"
        onMouseDown={(e) => e.preventDefault()}
      >
        {PARTS.map((i) => (
          <div key={i} className="sc-tour-catch-part" />
        ))}
      </div>
      <div ref={ringRef} className="sc-tour-ring" data-state={phase} aria-hidden="true" hidden />
      <div
        ref={cardRef}
        className="sc-tour"
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        data-state={phase}
      >
        <div ref={arrowRef} className="sc-tour-arrow" aria-hidden="true" hidden />
        <div className="sc-tour-head">
          <h2 id={titleId} className="sc-tour-title">
            {v.title}
          </h2>
          <Tip label="Close tour">
            <button type="button" className="sc-tour-x" aria-label="Close tour" onClick={() => p.onClose(stopId)}>
              <X size={16} />
            </button>
          </Tip>
        </div>
        <p id={bodyId} className="sc-tour-body">
          {v.body}
        </p>
        <div className="sc-tour-foot">
          {v.canBack && (
            <button
              ref={backRef}
              type="button"
              className="sc-tour-back"
              onClick={() => {
                pressed.current = 'back';
                p.onBack(stopId);
              }}
            >
              Back
            </button>
          )}
          <span className="sc-tour-count">
            <span className="sc-vh">Step </span>
            {v.index + 1}
            <span aria-hidden="true"> / </span>
            <span className="sc-vh"> of </span>
            {v.total}
          </span>
          <button
            ref={nextRef}
            type="button"
            className="sc-btn sc-btn-primary sc-tour-next"
            onClick={() => {
              pressed.current = 'next';
              p.onNext(stopId);
            }}
          >
            {v.last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** Floating UI's reference: a box of our choosing, scrolled with the target's own ancestors. */
function occluders(surface: Element): Box[] {
  const out: Box[] = [];
  for (const el of document.querySelectorAll(CHROME)) {
    if (el.contains(surface) || surface.contains(el) || el.getClientRects().length === 0) continue;
    out.push(boxOf(el.getBoundingClientRect()));
  }
  return out;
}

/** How far a bar pinned to the top of the screen reaches down. */
function barAbove(chrome: Box[], vh: number): number {
  return Math.max(0, ...chrome.filter((c) => c.top <= 0 && c.bottom < vh / 3).map((c) => c.bottom));
}

/** How far a bar pinned to the bottom of the screen reaches up. */
function barBelow(chrome: Box[], vh: number): number {
  return Math.max(0, ...chrome.filter((c) => c.bottom >= vh && c.top > (vh * 2) / 3).map((c) => vh - c.top));
}

function virtual(b: Box, context: Element): VirtualElement {
  const rect = {
    x: b.left,
    y: b.top,
    left: b.left,
    top: b.top,
    right: b.right,
    bottom: b.bottom,
    width: width(b),
    height: height(b),
  };
  return { getBoundingClientRect: () => rect, contextElement: context };
}

/**
 * The veil paints; it never takes a press. With a mask the window is cut from
 * the dim and the blur alike; without one, plain panels frame it. Either way
 * the clear catch panels around the window are what the page's presses land on.
 */
function paintVeil(veil: HTMLElement, catcher: HTMLElement, open: Box, radius: number, masked: boolean) {
  const parts = panels(open, window.innerWidth, window.innerHeight);
  if (masked) {
    const m = windowMask(open, radius);
    const s = veil.style;
    if (s.maskImage !== m.image) {
      s.maskImage = m.image;
      s.webkitMaskImage = m.image;
    }
    s.maskSize = m.size;
    s.webkitMaskSize = m.size;
    s.maskPosition = m.position;
    s.webkitMaskPosition = m.position;
  } else placeParts(veil, parts);
  placeParts(catcher, parts);
}

function placeParts(host: HTMLElement, parts: Box[]) {
  Array.from(host.children).forEach((el, i) => {
    const b = parts[i];
    const s = (el as HTMLElement).style;
    if (!b) {
      s.display = 'none';
      return;
    }
    Object.assign(s, {
      display: 'block',
      left: `${b.left}px`,
      top: `${b.top}px`,
      width: `${width(b)}px`,
      height: `${height(b)}px`,
    });
  });
}

const PARTS = [0, 1, 2, 3];

function maskSupported(): boolean {
  if (typeof CSS === 'undefined') return false;
  return CSS.supports('mask-composite', 'exclude') || CSS.supports('-webkit-mask-composite', 'xor');
}

/** The pane a target scrolls in. Inside a brand the document never scrolls; a page does. */
function scrollPane(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/**
 * Brings a target mostly out of view into its pane, once. Only that pane
 * scrolls, never the shell around it, and a target taller than the pane shows
 * from its top rather than from somewhere in its middle.
 */
function bringIntoView(target: HTMLElement, pane: HTMLElement | null, still: boolean): Promise<void> {
  if (!pane) return Promise.resolve();
  const tr = target.getBoundingClientRect();
  const pr = pane.getBoundingClientRect();
  const seen = Math.max(0, Math.min(tr.bottom, pr.bottom, window.innerHeight) - Math.max(tr.top, pr.top, 0));
  if (seen >= Math.min(120, tr.height * 0.4)) return Promise.resolve();
  const tall = tr.height > pr.height * 0.8;
  const delta = tall ? tr.top - pr.top - 16 : (tr.top + tr.bottom) / 2 - (pr.top + pr.bottom) / 2;
  pane.scrollBy({ top: delta, behavior: still ? 'auto' : 'smooth' });
  if (still) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pane.removeEventListener('scrollend', finish);
      resolve();
    };
    pane.addEventListener('scrollend', finish);
    window.setTimeout(finish, SCROLL_WAIT_MS);
  });
}

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => window.setTimeout(resolve, ms)) : Promise.resolve();
}

function focusable(el: HTMLElement): boolean {
  return el.matches('button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]');
}
