import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { X } from '@phosphor-icons/react';
import { arrow, autoUpdate, computePosition, flip, offset, shift, type VirtualElement } from '@floating-ui/dom';
import type { Side } from '../guidedTasks.js';
import { Tip } from './Tip.js';
import { createLock, type CoachLock } from './coachLock.js';
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
  windowsMask,
  windowsRim,
  type Box,
  type Window,
} from './coachGeometry.js';

/** Air between a live surface and its window. */
const SURFACE_PAD = 3;
/** A surface with no corners of its own (a block of text) gets room and a rounded window. */
const BLOCK_PAD = 10;
const BLOCK_RADIUS = 14;
/** Air between a control the card points at and the card. */
const RING_PAD = 6;
/** The window's edge on the curtain: quiet, near-monochrome, no glow. */
const RIM = 'rgba(255,255,255,0.16)';
/** What inside a live surface is drawn as its own window, with its own radius. */
const SHAPE = '[data-guide-shape]';
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
/**
 * What stays live while the coach holds the page, beside the card and the
 * step's own surfaces: every announcement, the toasts that report what just
 * happened, the update float that may need an answer, and the poppers a live
 * surface opens (a chip's peek, the swap sheet, a menu).
 */
const KEEP =
  '[aria-live], .sc-toasts, .sc-upd-float, .sc-upd-overlay, [data-radix-popper-content-wrapper], .sc-chip-preview, .sc-swap';

type Phase = 'moving' | 'shown' | 'stowed' | 'away';

/** What the card says, held while it fades so the words change only once it is out of sight. */
interface View {
  id: string;
  title?: string;
  body?: string;
  canBack: boolean;
  action: CoachmarkProps['action'];
}
const viewOf = (p: CoachmarkProps): View => ({
  id: p.id,
  title: p.title,
  body: p.body,
  canBack: p.canBack,
  action: p.action,
});

export interface CoachmarkProps {
  /** The step on screen. A new id is a new step. */
  id: string;
  /**
   * `coach` holds the page: a curtain over everything but the step's surfaces,
   * which stay sharp and working. `card` only points: no curtain, no hold, and
   * focus stays where the person put it.
   */
  voice: 'coach' | 'card';
  /** What the card points at. A coach step whose words sit in a surface's own slot has no card and no target. */
  target: HTMLElement | null;
  /** coach: the surfaces left open and live, such as the whole composer. */
  surfaces: readonly HTMLElement[];
  side: Side;
  title?: string;
  body?: string;
  canBack: boolean;
  /** The card's one button, when it has one: Next in a review, Done, Continue. */
  action: { label: string } | null;
  /** Beside its target the card is narrower, so it fits beside a picker, a dialog or a question on more screens. */
  beside?: boolean;
  /**
   * The surface that owns the screen: the page's body, or a shell that traps
   * focus over it (the presenter studio, a creation dialog, the open shot). The
   * coach is drawn inside it, so its card can be reached, and holds only it.
   */
  container: HTMLElement;
  closeLabel: string;
  onBack: (id: string) => void;
  onAction: (id: string) => void;
  onClose: (id: string) => void;
  /** coach: Escape puts the coach away until the step changes. */
  onEscape: (id: string) => void;
  /** The step is on screen. `focusMoved` is true when the card took focus, which announces it already. Keep it stable. */
  onShown: (id: string, focusMoved: boolean) => void;
}

/**
 * The guide's one drawn surface (DESIGN.md, "First use").
 *
 * As a coach it is a window in a curtain: the page behind goes dark and soft
 * and holds still (inert, so it takes no press, no Tab and no reader cursor),
 * and the step's own surfaces show through sharp and fully working, because
 * they are the real controls and not a picture of them. The card sits beside
 * its target, centred on it and pointing at it, and never covers it.
 *
 * As a card it is the same card with none of the hold: a word beside
 * something that just happened, while the page stays the person's.
 *
 * It owns no product logic: GuideHost decides which step is showing; this
 * draws it where the control actually is and holds the page while it does.
 */
export function Coachmark(p: CoachmarkProps) {
  const { id, voice, target, surfaces, side, container, onShown } = p;
  const coach = voice === 'coach';
  const hasCard = !!target && !!(p.title || p.body);
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const catchRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const rimRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const pressed = useRef<'back' | 'action' | null>(null);
  const lock = useRef<CoachLock | null>(null);
  const [phase, setPhase] = useState<Phase>('moving');
  const [masked] = useState(maskSupported);
  const [view, setView] = useState<View>(() => viewOf(p));
  const latest = useRef(p);
  latest.current = p;
  const everShown = useRef(false);
  const v = phase === 'shown' && view.id === id ? viewOf(p) : view;
  // Surfaces arrive as a fresh array each render; the effects follow what is in it.
  const surfaceKey = useSurfaceKey(surfaces);

  // One lock for the life of the coach on screen, released however it ends.
  useEffect(() => {
    if (!coach) return;
    lock.current = createLock(container);
    return () => {
      lock.current?.release();
      lock.current = null;
    };
  }, [coach, container]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const pointer = arrowRef.current;
    const veil = veilRef.current;
    const catcher = catchRef.current;
    const ring = ringRef.current;
    const rim = rimRef.current;
    if (coach && (!veil || !catcher || !ring || !rim)) return;
    if (hasCard && (!card || !pointer)) return;
    let alive = true;
    let token = 0;
    let frame = 0;
    let shown = false;
    let held = false;
    let stopAuto: (() => void) | null = null;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lead = surfaces[0] ?? target;
    if (!lead) return;
    let painted = '';
    const pane = target ? scrollPane(target) : null;
    setPhase('moving');

    const hold = () =>
      lock.current?.set([
        ...(card ? [card] : []),
        ...(veil ? [veil] : []),
        ...(catcher ? [catcher] : []),
        ...(ring ? [ring] : []),
        ...(rim ? [rim] : []),
        ...surfaces,
        ...document.querySelectorAll(KEEP),
      ]);

    // What it points at moved out of every pane (momentum, a resize): nothing
    // is left to point at, so the page is let go until it comes back.
    const away = () => {
      lock.current?.release();
      held = false;
      setPhase('away');
    };

    const update = async () => {
      const my = ++token;
      if ((target && !target.isConnected) || surfaces.some((s) => !s.isConnected)) return away();
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
      const chrome = occluders(lead, container);
      // Only a bar across the screen cuts a window short; a small float over a corner does not.
      const bars = chrome.filter((c) => width(c) > vw / 3);
      const seen = target ? visibleRect(boxOf(target.getBoundingClientRect()), clips) : null;
      const t = seen && trimBy(seen, bars);
      if (target && !t) return away();
      // The windows are the shapes inside each live surface, each with the
      // radius it really has; a surface with no marked shapes is its own window.
      const windows: Window[] = [];
      const shapes: HTMLElement[] = [];
      for (const s of surfaces) {
        const inner = [...(s.matches(SHAPE) ? [s] : []), ...s.querySelectorAll<HTMLElement>(SHAPE)];
        shapes.push(...(inner.length ? inner : [s]));
      }
      let r: Box | null = null;
      for (const el of shapes) {
        const b = visibleRect(boxOf(el.getBoundingClientRect()), clips);
        const trimmed = b && trimBy(b, bars);
        if (!trimmed) continue;
        const corner = cornerRadius(el);
        windows.push(
          corner >= 4
            ? { ...pad(trimmed, SURFACE_PAD), radius: corner + SURFACE_PAD }
            : { ...pad(trimmed, BLOCK_PAD), radius: BLOCK_RADIUS },
        );
        r = r ? union(r, trimmed) : trimmed;
      }
      if (!t && !r) return away();
      // Held once per showing, and again whenever the page has redrawn a
      // surface somewhere the hold does not reach (a bar swapped at a breakpoint).
      if (held && (surfaces.some((s) => s.closest('[inert]')) || card?.closest('[inert]'))) held = false;

      if (coach && veil && catcher && ring && rim) {
        if (!windows.length && t)
          windows.push({ ...pad(t, RING_PAD), radius: cornerRadius(target as HTMLElement) + RING_PAD });
        const boxes = windows.map((w) => [w.left, w.top, w.right, w.bottom, w.radius].map(Math.round).join(','));
        const key = `${boxes.join('|')}@${vw}x${vh}`;
        if (key !== painted) {
          painted = key;
          paintVeil(veil, catcher, rim, windows, masked);
        }
        // A button inside a window wears a thin ring of its own; a window that is
        // itself the target, or a field to type in, does not.
        if (target && t && !shapes.includes(target) && target.matches('button, a[href], [role="button"]')) {
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
      }

      if (card && pointer && target && t) {
        // The bars the page pins to its top and bottom are not room for the card.
        const room = {
          top: EDGE + barAbove(chrome, vh),
          bottom: EDGE + barBelow(chrome, vh),
          left: EDGE,
          right: EDGE,
        };
        const place = (ref: Box, fallbacks: Side[] | undefined) =>
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
          intersects(
            { left: x, top: y, right: x + card.offsetWidth, bottom: y + card.offsetHeight },
            pad(t, SURFACE_PAD),
          );
        // A card beside its target, on a screen too narrow for either side, goes below or above it instead.
        const sideways = side === 'left' || side === 'right';
        const fallbacks: Side[] | undefined = r
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
        // On a small phone with the keyboard up there may be no room that leaves
        // the target clear. The card waits, out of the way, for the room to come back.
        if (covers(res.x, res.y)) return setPhase('stowed');

        const placed = res.placement.split('-')[0] as Side;
        card.style.left = `${Math.round(res.x)}px`;
        card.style.top = `${Math.round(res.y)}px`;
        card.dataset.side = placed;
        const a = res.middlewareData.arrow;
        pointer.dataset.edge = opposite(placed);
        pointer.style.left = a?.x != null ? `${a.x}px` : '';
        pointer.style.top = a?.y != null ? `${a.y}px` : '';
        pointer.hidden = !a || Math.abs(a.centerOffset) > 1;
      }

      if (coach && !held) {
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

    // The first time a step is on screen: focus, for a coach card only, and the announcement.
    const settle = () => {
      everShown.current = true;
      let moved = false;
      if (coach && card) {
        const inSurface = (n: Element | null) => !!n && surfaces.some((s) => s.contains(n));
        // A card button that handed the caret to a live surface (Continue into the brief) leaves it there.
        if (pressed.current && inSurface(document.activeElement)) pressed.current = null;
        else if (pressed.current) {
          const again = pressed.current === 'back' ? backRef.current : null;
          (again ?? actionRef.current ?? card).focus({ preventScroll: true });
          pressed.current = null;
        } else {
          const active = document.activeElement;
          if (
            !active ||
            active === document.body ||
            !(card.contains(active) || surfaces.some((s) => s.contains(active)))
          ) {
            card.focus({ preventScroll: true });
            moved = true;
          }
        }
      }
      onShown(id, moved);
    };

    // Fade out what was showing, change the words, bring a target below the
    // fold up once in its own pane, and only then place the card and fade it in.
    const fade = everShown.current && !still && hasCard ? FADE_MS : 0;
    void wait(fade)
      .then(() => {
        if (!alive) return;
        flushSync(() => setView(viewOf(latest.current)));
        return target ? bringIntoView(target, pane, still) : undefined;
      })
      .then(() => {
        if (!alive) return;
        stopAuto = autoUpdate(lead, card ?? veil ?? lead, schedule);
      });
    const ro = new ResizeObserver(schedule);
    for (const s of surfaces) ro.observe(s);
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
  }, [id, coach, hasCard, target, surfaceKey, side, container, onShown, masked]);

  // The card's words describe the control while it is the one being pointed at.
  useEffect(() => {
    if (!hasCard || !target || !focusable(target)) return;
    const ids = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    if (ids.includes(bodyId)) return;
    target.setAttribute('aria-describedby', [...ids, bodyId].join(' '));
    return () => {
      const now = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((x) => x && x !== bodyId);
      if (now.length) target.setAttribute('aria-describedby', now.join(' '));
      else target.removeAttribute('aria-describedby');
    };
  }, [hasCard, target, bodyId]);

  // A coach's keys belong to it and its surfaces. Escape puts it away for this
  // step; nothing pressed on the card or the page behind reaches the page's
  // own shortcuts. A card leaves every key to the page.
  const { onEscape } = p;
  useEffect(() => {
    if (!coach) return;
    const inSurfaces = (n: Node | null) => !!n && surfaces.some((s) => s.contains(n));
    const onKey = (e: KeyboardEvent) => {
      const card = cardRef.current;
      const from = e.target instanceof Node ? e.target : null;
      const inSurface = inSurfaces(from);
      const active = document.activeElement;
      if (e.key === 'Escape') {
        // A surface that answered the key itself (the picker closing) has had it.
        if (e.defaultPrevented) return;
        if (active?.closest('[role="dialog"]:not(.sc-coach):not(.sc-attachpanel)')) return;
        if (
          inSurface &&
          active?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]')
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        onEscape(id);
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
    // coach has made inert) comes to the card rather than leaving the reader
    // lost. A press inside a live surface is left to that surface.
    let frame = 0;
    let pressInSurface = false;
    const onDown = (e: PointerEvent) => {
      pressInSurface = e.target instanceof Node && inSurfaces(e.target);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget || pressInSurface || !cardRef.current) return;
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
  }, [id, coach, surfaceKey, onEscape]);

  return createPortal(
    <>
      {coach && (
        <>
          <div
            ref={veilRef}
            className="sc-coach-veil"
            data-veil={masked ? 'mask' : 'panels'}
            data-state={phase}
            aria-hidden="true"
          >
            {PARTS.map((i) => (
              <div key={i} className="sc-coach-panel" />
            ))}
          </div>
          <div
            ref={catchRef}
            className="sc-coach-catch"
            data-guide="catch"
            data-state={phase}
            aria-hidden="true"
            onMouseDown={(e) => e.preventDefault()}
          >
            {PARTS.map((i) => (
              <div key={i} className="sc-coach-catch-part" />
            ))}
          </div>
          <div ref={rimRef} className="sc-coach-rim" data-state={phase} aria-hidden="true" />
          <div ref={ringRef} className="sc-coach-ring" data-state={phase} aria-hidden="true" hidden />
        </>
      )}
      {hasCard && (
        <div
          ref={cardRef}
          className="sc-coach"
          data-guide="card"
          data-voice={voice}
          data-beside={p.beside || undefined}
          // A coach holds the page and takes focus, so it is a dialog; a card only annotates.
          {...(coach ? { role: 'dialog', 'aria-labelledby': v.title ? titleId : undefined } : { role: 'note' })}
          aria-describedby={bodyId}
          tabIndex={-1}
          data-state={phase}
        >
          <div ref={arrowRef} className="sc-coach-arrow" aria-hidden="true" hidden />
          <div className="sc-coach-head">
            {v.title ? (
              <h2 id={titleId} className="sc-coach-title">
                {v.title}
              </h2>
            ) : (
              <p id={bodyId} className="sc-coach-body" data-lead="">
                {v.body}
              </p>
            )}
            <Tip label={p.closeLabel}>
              <button type="button" className="sc-coach-x" aria-label={p.closeLabel} onClick={() => p.onClose(id)}>
                <X size={16} />
              </button>
            </Tip>
          </div>
          {v.title && v.body && (
            <p id={bodyId} className="sc-coach-body">
              {v.body}
            </p>
          )}
          {(v.canBack || v.action) && (
            <div className="sc-coach-foot">
              {v.canBack && (
                <button
                  ref={backRef}
                  type="button"
                  className="sc-coach-back"
                  onClick={() => {
                    pressed.current = 'back';
                    p.onBack(id);
                  }}
                >
                  Back
                </button>
              )}
              {v.action && (
                <button
                  ref={actionRef}
                  type="button"
                  className="sc-btn sc-btn-primary sc-coach-next"
                  onClick={() => {
                    pressed.current = 'action';
                    p.onAction(id);
                  }}
                >
                  {v.action.label}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>,
    container,
  );
}

/** A stable stand-in for a list of elements, so an effect reruns only when the list really changes. */
function useSurfaceKey(surfaces: readonly HTMLElement[]): readonly HTMLElement[] {
  const ref = useRef(surfaces);
  if (ref.current.length !== surfaces.length || ref.current.some((s, i) => s !== surfaces[i])) ref.current = surfaces;
  return ref.current;
}

function occluders(surface: Element, container: Element): Box[] {
  const out: Box[] = [];
  for (const el of document.querySelectorAll(CHROME)) {
    // chrome under a shell that owns the screen is not over anything the guide shows
    if (!container.contains(el)) continue;
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

/** Floating UI's reference: a box of our choosing, scrolled with the target's own ancestors. */
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
 * The veil paints; it never takes a press. With a mask every window is cut
 * from the dim and the blur alike, and the rim traces the windows' outer edge;
 * without one, plain panels frame the windows' union. Either way the clear
 * catch panels around the union are what the page's presses land on.
 */
function paintVeil(veil: HTMLElement, catcher: HTMLElement, rim: HTMLElement, windows: Window[], masked: boolean) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const all = windows.reduce<Box | null>((u, w) => (u ? union(u, w) : w), null);
  const parts = all ? panels(all, vw, vh) : [];
  if (masked) {
    const image = windowsMask(windows, vw, vh);
    const s = veil.style;
    s.maskImage = image;
    s.webkitMaskImage = image;
    rim.style.backgroundImage = windowsRim(windows, vw, vh, RIM);
  } else placeParts(veil, parts);
  placeParts(catcher, parts);
}

/** A shape's corner, as drawn: the top-left radius, which every shape the guide windows uses shares. */
function cornerRadius(el: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
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
  return CSS.supports('mask-image', 'url("x.svg")') || CSS.supports('-webkit-mask-image', 'url("x.svg")');
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
