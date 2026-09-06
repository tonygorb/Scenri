import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  type Pt,
  type Size,
  type View,
  clampPan,
  isFit,
  limits,
  overflows,
  panBy,
  pinchView,
  toggleTarget,
  zoomTo,
} from './zoomRules.js';

/** How far the arrow keys move the picture. */
const KEY_PAN = 80;
/** Two taps this close in time and space are one double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 24;
/** A pointer that travelled this far was dragging, not clicking. */
const DRAG_PX = 4;
/** A pinch that lets go this close to fit has gone back to fit. */
const SNAP = 1.05;

type Gesture = { kind: 'drag'; last: Pt; moved: number } | { kind: 'pinch'; base: View; from: { a: Pt; b: Pt } };

/** Where the layout put the frame at fit, so the transform can start from the identity. */
interface Frame {
  fit: number;
  ox: number;
  oy: number;
}

export interface StageZoom {
  /** The viewport: the stage's picture row. */
  viewRef: (el: HTMLElement | null) => void;
  /** The frame the layout sizes to fit; the loupe transforms it. */
  frameRef: (el: HTMLElement | null) => void;
  /** The picture, for its pixels. */
  imgRef: (el: HTMLImageElement | null) => void;
  onImgLoad: (el: HTMLImageElement) => void;
  /** Everything the viewport element wears. */
  viewProps: {
    tabIndex: 0;
    'data-zoomed'?: '';
    'data-dragging'?: '';
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  };
  /** The frame's transform away from fit; undefined at fit, where the layout is the truth. */
  frameStyle: CSSProperties | undefined;
  zoomed: boolean;
}

/**
 * The loupe: one gesture, one state.
 *
 * A click on the picture shows it at actual size (or at twice fit, when
 * actual size is no closer a look), about the point clicked; a click takes
 * it back. Close up, a drag pans and so does the wheel. On touch a double
 * tap does what the click does, one finger pans, and a pinch sets the scale
 * itself, settling on fit when it lets go near it. Enter or Space is the
 * click from the keyboard and the arrows pan. Nothing to read and nothing
 * to choose: the way every photo tool's loupe reads.
 *
 * The stage's own layout decides the fit (the frame's width over the
 * picture's pixels), so at fit nothing is transformed and nothing can drift.
 * Every read of the numbers goes through refs, since gestures arrive faster
 * than renders.
 */
export function useStageZoom({
  hash,
}: {
  /** The picture on the stage; a new one starts at fit. */
  hash: string | undefined;
}): StageZoom {
  const [viewEl, setViewEl] = useState<HTMLElement | null>(null);
  const [frameEl, setFrameEl] = useState<HTMLElement | null>(null);
  const [viewport, setViewport] = useState<Size | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [eased, setEased] = useState(false);
  const [dragging, setDragging] = useState(false);
  const l = frame ? limits(frame.fit) : null;

  const viewRef = useRef(view);
  viewRef.current = view;
  const vpRef = useRef(viewport);
  vpRef.current = viewport;
  const natRef = useRef(natural);
  natRef.current = natural;
  const limRef = useRef(l);
  limRef.current = l;
  const frameRef = useRef(frame);
  frameRef.current = frame;

  /**
   * Whether the person zoomed, remembered apart from the numbers: the frame
   * changes size on its own (the strip arriving under it, the panel being
   * dragged), and a view that merely no longer matches the new fit is not a
   * zoom. A fitted picture follows its frame; a zoomed one keeps its scale.
   */
  const userZoomed = useRef(false);
  const go = useCallback((next: View, ease: boolean) => {
    const lim = limRef.current;
    const f = frameRef.current;
    // fit is the layout's own place, wherever the last move left the picture
    const at = lim && f && isFit(next.scale, lim) ? { scale: f.fit, tx: f.ox, ty: f.oy } : next;
    userZoomed.current = !!lim && !isFit(at.scale, lim);
    viewRef.current = at;
    setEased(ease);
    setView(at);
  }, []);

  // A new picture starts at fit, and its frame is measured afresh: a frame
  // left over from the last picture would seed a view at the wrong scale.
  const [seen, setSeen] = useState(hash);
  if (seen !== hash) {
    setSeen(hash);
    setNatural(null);
    setFrame(null);
    setView(null);
    userZoomed.current = false;
  }

  // the viewport is the picture's row; it changes with the window and the panel
  useLayoutEffect(() => {
    if (!viewEl) return;
    const read = () => setViewport({ w: viewEl.clientWidth, h: viewEl.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(viewEl);
    return () => ro.disconnect();
  }, [viewEl]);

  // the frame at fit, as the layout placed it; offsets are untouched by transforms
  useLayoutEffect(() => {
    if (!frameEl || !natural) return;
    const read = () => {
      const w = frameEl.offsetWidth;
      if (w > 0) setFrame({ fit: w / natural.w, ox: frameEl.offsetLeft, oy: frameEl.offsetTop });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(frameEl);
    return () => ro.disconnect();
  }, [frameEl, natural]);

  const readNatural = useCallback((el: HTMLImageElement | null) => {
    if (!el?.complete) return;
    const { naturalWidth: w, naturalHeight: h } = el;
    if (w && h) setNatural((cur) => (cur && cur.w === w && cur.h === h ? cur : { w, h }));
  }, []);

  // The first view is fit, which is the identity. A resize keeps a fitted
  // view fitted and keeps a zoomed one on the picture.
  useLayoutEffect(() => {
    if (!viewport || !natural || !frame) return;
    const atFit: View = { scale: frame.fit, tx: frame.ox, ty: frame.oy };
    setEased(false);
    setView((cur) => {
      const next = cur === null || !userZoomed.current ? atFit : clampPan(cur, viewport, natural);
      viewRef.current = next;
      return next;
    });
  }, [viewport, natural, frame]);

  const nums = () => {
    const v = viewRef.current;
    const vp = vpRef.current;
    const nat = natRef.current;
    const lim = limRef.current;
    return v && vp && nat && lim ? { v, vp, nat, lim } : null;
  };
  const zoomedNow = () => {
    const n = nums();
    return !!n && !isFit(n.v.scale, n.lim);
  };
  const toFit = () => {
    const f = frameRef.current;
    if (!f) return;
    go({ scale: f.fit, tx: f.ox, ty: f.oy }, true);
    userZoomed.current = false;
  };
  /** The click: the look about a point, or fit again. */
  const toggle = (at: Pt) => {
    const n = nums();
    if (!n) return;
    const target = toggleTarget(n.v.scale, n.lim);
    if (isFit(target, n.lim)) toFit();
    else go(zoomTo(n.v, target, at.x, at.y, n.vp, n.nat, n.lim), true);
  };
  /** At fit only a click on the picture itself is a click; zoomed, the whole row answers. */
  const onPicture = (e: { clientX: number; clientY: number }) => {
    if (zoomedNow()) return true;
    const r = frameEl?.getBoundingClientRect();
    return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };

  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; at: Pt } | null>(null);
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = viewEl?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const v = viewRef.current;
    if (pointers.current.size === 2 && v) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', base: v, from: { a, b } };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (pointers.current.size === 1) {
      gesture.current = { kind: 'drag', last: p, moved: 0 };
      // at fit a finger is the page's (it scrolls, it swipes); only a zoomed picture takes it
      if (zoomedNow() || e.pointerType === 'mouse') e.currentTarget.setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    const n = nums();
    if (!g || !n) return;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      go(pinchView(g.base, g.from, { a, b }, n.vp, n.nat, n.lim), false);
    } else if (g.kind === 'drag') {
      const dx = p.x - g.last.x;
      const dy = p.y - g.last.y;
      g.moved += Math.abs(dx) + Math.abs(dy);
      g.last = p;
      if (overflows(n.v, n.vp, n.nat)) {
        if (!dragging && g.moved > DRAG_PX) setDragging(true);
        go(panBy(n.v, dx, dy, n.vp, n.nat), false);
      }
    }
  };
  const release = (e: ReactPointerEvent<HTMLElement>) => {
    const p = pointers.current.get(e.pointerId) ?? null;
    pointers.current.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 1) {
      // a pinch that lost a finger carries on as a drag from the finger that stayed
      const [rest] = [...pointers.current.values()];
      gesture.current = { kind: 'drag', last: rest, moved: DRAG_PX + 1 };
      return { g, p, still: false };
    }
    gesture.current = null;
    setDragging(false);
    // a pinch that let go near fit has gone back to fit
    if (g?.kind === 'pinch') {
      const n = nums();
      if (n && n.v.scale < n.lim.fit * SNAP) toFit();
    }
    return { g, p, still: g?.kind === 'drag' && g.moved <= DRAG_PX };
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const { p, still } = release(e);
    if (!still || !p || !onPicture(e)) return;
    if (e.pointerType === 'mouse') {
      toggle(p);
      return;
    }
    // a touch double tap: the browser's own is switched off with touch-action
    const now = performance.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(p.x - prev.at.x, p.y - prev.at.y) < DOUBLE_TAP_PX) {
      lastTap.current = null;
      toggle(p);
    } else lastTap.current = { t: now, at: p };
  };
  const onPointerCancel = (e: ReactPointerEvent<HTMLElement>) => {
    release(e);
  };

  // Close up, the wheel pans, which is what a wheel over a picture larger
  // than its box has always done. At fit it is not the picture's. Native,
  // because React's wheel listener is passive and cannot stop the page.
  useEffect(() => {
    const el = viewEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const n = nums();
      if (!n || !overflows(n.v, n.vp, n.nat)) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      go(panBy(n.v, -e.deltaX * unit, -e.deltaY * unit, n.vp, n.nat), false);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewEl, go]);

  // Enter or Space is the click, about the middle. The arrows are the
  // picture's only close up; at fit they fall through to the overlay, which
  // walks shots on them.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const vp = vpRef.current;
      if (vp) toggle({ x: vp.w / 2, y: vp.h / 2 });
      e.preventDefault();
      return;
    }
    if (!zoomedNow()) return;
    const dx = e.key === 'ArrowLeft' ? KEY_PAN : e.key === 'ArrowRight' ? -KEY_PAN : 0;
    const dy = e.key === 'ArrowUp' ? KEY_PAN : e.key === 'ArrowDown' ? -KEY_PAN : 0;
    if (!dx && !dy) return;
    const n = nums();
    if (n) go(panBy(n.v, dx, dy, n.vp, n.nat), true);
    e.preventDefault();
  };

  const zoomed = !!(view && l && !isFit(view.scale, l));
  const frameStyle: CSSProperties | undefined =
    zoomed && view && frame
      ? {
          transform: `translate(${view.tx - frame.ox}px, ${view.ty - frame.oy}px) scale(${view.scale / frame.fit})`,
          transition: eased ? undefined : 'none',
        }
      : undefined;

  return {
    viewRef: setViewEl,
    frameRef: setFrameEl,
    imgRef: readNatural,
    onImgLoad: readNatural,
    viewProps: {
      tabIndex: 0,
      'data-zoomed': zoomed ? '' : undefined,
      'data-dragging': dragging ? '' : undefined,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onKeyDown,
    },
    frameStyle,
    zoomed,
  };
}
