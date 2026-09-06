import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ImageSquare, MagnifyingGlassMinus, MagnifyingGlassPlus, X } from '@phosphor-icons/react';
import { imgUrl } from '../../api.js';
import { focusSelfOnOpen } from '../../app/dialogs.js';
import { Tip } from '../Tip.js';
import {
  type Limits,
  type Pt,
  type Size,
  type View,
  STEP,
  clampPan,
  fitView,
  isFit,
  limits,
  overflows,
  panBy,
  pinchView,
  showsPixels,
  toggleTarget,
  zoomBy,
  zoomLabel,
  zoomTo,
} from './viewerRules.js';

/** How far the arrow keys move the picture. */
const KEY_PAN = 80;
/** Two taps this close in time and space are one double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 24;
/** A pointer that travelled this far was dragging, not tapping. */
const DRAG_PX = 4;

type Gesture = { kind: 'drag'; last: Pt; moved: number } | { kind: 'pinch'; base: View; from: { a: Pt; b: Pt } };

/**
 * Looking at the shot properly.
 *
 * The Refine workspace shows the picture at the stage's cap; this shows it
 * at fit, at actual size and up to three device pixels per image pixel, and
 * nothing else: no actions, no strip, no caption. It is inspection, and the
 * workspace one Escape away is where the decision gets made.
 *
 * The source is the same original the stage already loaded (`imgUrl`, cached
 * as immutable), so opening this costs no bytes and no derivative. "100%" is
 * one image pixel per device pixel, which is the only honest meaning of it.
 *
 * Radix's dialog primitives carry the portal, the trap, the scroll lock,
 * Escape, and the focus return to whichever control opened this. The pointer
 * arithmetic lives in viewerRules.ts, where the unit tests can reach it.
 */
export function ImageViewer({
  hash,
  label,
  size,
  onClose,
}: {
  hash: string;
  /** What the picture is, for the dialog's name and the image's alt. */
  label: string;
  /** The pixels the run recorded, so the fit is right before the first byte; the loaded image corrects it if they disagree. */
  size: [number, number] | null;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size | null>(null);
  const [natural, setNatural] = useState<Size | null>(size ? { w: size[0], h: size[1] } : null);
  const [view, setView] = useState<View | null>(null);
  const [eased, setEased] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [broken, setBroken] = useState(false);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const l = viewport && natural ? limits(viewport, natural, dpr) : null;

  // Gestures arrive faster than renders, so they read the latest numbers off
  // refs rather than off the closure of the last paint.
  const viewRef = useRef(view);
  viewRef.current = view;
  const vpRef = useRef(viewport);
  vpRef.current = viewport;
  const natRef = useRef(natural);
  natRef.current = natural;
  const limRef = useRef(l);
  limRef.current = l;

  const go = useCallback((next: View, ease: boolean) => {
    viewRef.current = next;
    setEased(ease);
    setView(next);
  }, []);

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const read = () => setViewport({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The first view is the fitted one. A resize keeps a fitted view fitted
  // and keeps a zoomed one on the picture.
  const usedLim = useRef<Limits | null>(null);
  useLayoutEffect(() => {
    if (!viewport || !natural) return;
    const lim = limits(viewport, natural, dpr);
    const prev = usedLim.current;
    usedLim.current = lim;
    setEased(false);
    setView((cur) => {
      const next =
        cur === null || !prev || isFit(cur.scale, prev)
          ? fitView(viewport, natural, lim)
          : clampPan(cur, viewport, natural);
      viewRef.current = next;
      return next;
    });
  }, [viewport, natural, dpr]);

  const ready = !!(view && viewport && natural && l);
  const centre = (): Pt => ({ x: (vpRef.current?.w ?? 0) / 2, y: (vpRef.current?.h ?? 0) / 2 });
  const zoomStep = (dir: 1 | -1, at?: Pt) => {
    const v = viewRef.current;
    const vp = vpRef.current;
    const nat = natRef.current;
    const lim = limRef.current;
    if (!v || !vp || !nat || !lim) return;
    const p = at ?? centre();
    go(zoomBy(v, dir > 0 ? STEP : 1 / STEP, p.x, p.y, vp, nat, lim), true);
  };
  const toFit = () => {
    const vp = vpRef.current;
    const nat = natRef.current;
    const lim = limRef.current;
    if (vp && nat && lim) go(fitView(vp, nat, lim), true);
  };
  const toActual = () => {
    const v = viewRef.current;
    const vp = vpRef.current;
    const nat = natRef.current;
    const lim = limRef.current;
    if (!v || !vp || !nat || !lim) return;
    const c = centre();
    go(zoomTo(v, lim.actual, c.x, c.y, vp, nat, lim), true);
  };
  const toggle = (at: Pt) => {
    const v = viewRef.current;
    const vp = vpRef.current;
    const nat = natRef.current;
    const lim = limRef.current;
    if (!v || !vp || !nat || !lim) return;
    go(zoomTo(v, toggleTarget(v.scale, lim), at.x, at.y, vp, nat, lim), true);
  };

  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; at: Pt } | null>(null);
  const lastType = useRef<string>('mouse');
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvasRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    lastType.current = e.pointerType;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const v = viewRef.current;
    if (pointers.current.size === 2 && v) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', base: v, from: { a, b } };
    } else if (pointers.current.size === 1) {
      gesture.current = { kind: 'drag', last: p, moved: 0 };
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    const v = viewRef.current;
    const vp = vpRef.current;
    const nat = natRef.current;
    const lim = limRef.current;
    if (!g || !v || !vp || !nat || !lim) return;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      go(pinchView(g.base, g.from, { a, b }, vp, nat, lim), false);
    } else if (g.kind === 'drag') {
      const dx = p.x - g.last.x;
      const dy = p.y - g.last.y;
      g.moved += Math.abs(dx) + Math.abs(dy);
      g.last = p;
      if (overflows(v, vp, nat)) {
        if (!dragging && g.moved > DRAG_PX) setDragging(true);
        go(panBy(v, dx, dy, vp, nat), false);
      }
    }
  };
  const release = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId) ?? null;
    pointers.current.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 1) {
      // a pinch that lost a finger carries on as a drag from the finger that stayed
      const [rest] = [...pointers.current.values()];
      gesture.current = { kind: 'drag', last: rest, moved: DRAG_PX + 1 };
      return { g, p, tap: false };
    }
    gesture.current = null;
    setDragging(false);
    return { g, p, tap: g?.kind === 'drag' && g.moved <= DRAG_PX && e.pointerType !== 'mouse' };
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { p, tap } = release(e);
    if (!tap || !p) return;
    // a touch double tap: the browser's own is switched off with touch-action
    const now = performance.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(p.x - prev.at.x, p.y - prev.at.y) < DOUBLE_TAP_PX) {
      lastTap.current = null;
      toggle(p);
    } else lastTap.current = { t: now, at: p };
  };
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    release(e);
  };
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // a touch double tap is handled above; Chrome fires dblclick for it too
    if (lastType.current === 'mouse') toggle(local(e));
  };

  // Wheel is a native listener: React's is passive, and this one has to stop
  // the page. A pinch on a trackpad arrives as a wheel with ctrlKey.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const vp = vpRef.current;
      const nat = natRef.current;
      const lim = limRef.current;
      if (!v || !vp || !nat || !lim) return;
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        const dy = Math.max(-40, Math.min(40, e.deltaY * unit));
        const r = el.getBoundingClientRect();
        go(zoomBy(v, Math.exp(-dy * 0.008), e.clientX - r.left, e.clientY - r.top, vp, nat, lim), false);
      } else if (overflows(v, vp, nat)) {
        go(panBy(v, -e.deltaX * unit, -e.deltaY * unit, vp, nat), false);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [go]);

  // Every key here is taken, arrows included even at fit: the overlay under
  // this walks shots on the same arrows, and it checks defaultPrevented first.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const pan = (dx: number, dy: number) => {
      const v = viewRef.current;
      const vp = vpRef.current;
      const nat = natRef.current;
      if (v && vp && nat) go(panBy(v, dx, dy, vp, nat), true);
    };
    switch (e.key) {
      case '+':
      case '=':
        zoomStep(1);
        break;
      case '-':
      case '_':
        zoomStep(-1);
        break;
      case '0':
        toFit();
        break;
      case '1':
        toActual();
        break;
      case 'ArrowLeft':
        pan(KEY_PAN, 0);
        break;
      case 'ArrowRight':
        pan(-KEY_PAN, 0);
        break;
      case 'ArrowUp':
        pan(0, KEY_PAN);
        break;
      case 'ArrowDown':
        pan(0, -KEY_PAN);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const atFit = !!(view && l && isFit(view.scale, l));
  const reading = view && l ? zoomLabel(view.scale, l, dpr) : 'Fit';
  const canOut = !!(view && l && view.scale > l.min * 1.001);
  const canIn = !!(view && l && view.scale < l.max * 0.999);

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="sc-viewer-scrim" />
        <Dialog.Content
          className="sc-viewer"
          aria-describedby={undefined}
          onOpenAutoFocus={focusSelfOnOpen}
          onKeyDown={onKeyDown}
        >
          <Dialog.Title className="sc-viewer-title">Zoom, {label}</Dialog.Title>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the picture surface takes pointer gestures, and the keyboard reaches the same zoom through the dialog's own keys and the buttons below */}
          <div
            ref={canvasRef}
            className="sc-viewer-canvas"
            data-pan={ready && view && viewport && natural && overflows(view, viewport, natural) ? '' : undefined}
            data-dragging={dragging || undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onDoubleClick={onDoubleClick}
          >
            {broken ? (
              <span className="sc-viewer-blank">
                <ImageSquare size={28} />
                Image unavailable
              </span>
            ) : (
              <img
                className="sc-viewer-img"
                src={imgUrl(hash)}
                alt={label}
                draggable={false}
                data-eased={eased || undefined}
                data-pixels={view && showsPixels(view.scale, dpr) ? '' : undefined}
                style={
                  view && natural
                    ? {
                        width: natural.w,
                        height: natural.h,
                        transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
                      }
                    : { visibility: 'hidden' }
                }
                onLoad={(e) => {
                  const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                  if (w && h && (!natural || natural.w !== w || natural.h !== h)) setNatural({ w, h });
                }}
                onError={() => setBroken(true)}
              />
            )}
          </div>
          <Tip label="Close (esc)">
            <Dialog.Close asChild>
              <button type="button" className="sc-icon-btn sc-viewer-close" aria-label="Close">
                <X size={13} />
              </button>
            </Dialog.Close>
          </Tip>
          <div className="sc-viewer-bar">
            <Tip label="Zoom out (-)">
              <button
                type="button"
                className="sc-icon-btn"
                aria-label="Zoom out"
                disabled={!canOut}
                onClick={() => zoomStep(-1)}
              >
                <MagnifyingGlassMinus size={14} />
              </button>
            </Tip>
            <Tip label={atFit ? 'Actual size (1)' : 'Fit (0)'}>
              <button
                type="button"
                className="sc-viewer-zoom"
                aria-label={atFit ? 'Actual size' : 'Fit'}
                onClick={() => (atFit ? toActual() : toFit())}
              >
                {reading}
              </button>
            </Tip>
            <Tip label="Zoom in (+)">
              <button
                type="button"
                className="sc-icon-btn"
                aria-label="Zoom in"
                disabled={!canIn}
                onClick={() => zoomStep(1)}
              >
                <MagnifyingGlassPlus size={14} />
              </button>
            </Tip>
          </div>
          <span className="sc-viewer-status" role="status">
            {ready ? `Zoom ${reading}` : ''}
          </span>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
