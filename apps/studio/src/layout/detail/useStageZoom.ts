import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
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
  STEP,
  clampPan,
  isActual,
  isFill,
  isFit,
  limits,
  overflows,
  panBy,
  pinchView,
  toggleTarget,
  zoomBy,
  zoomLabel,
  zoomTo,
} from './zoomRules.js';

/** How far the arrow keys move the picture. */
const KEY_PAN = 80;
/** Two taps this close in time and space are one double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 24;
/** A pointer that travelled this far was dragging, not tapping. */
const DRAG_PX = 4;

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
  /** The frame the layout sizes to fit; the zoom transforms it. */
  frameRef: (el: HTMLElement | null) => void;
  /** The picture, for its pixels. */
  imgRef: (el: HTMLImageElement | null) => void;
  onImgLoad: (el: HTMLImageElement) => void;
  /** Everything the viewport element wears. */
  viewProps: {
    tabIndex: 0;
    'aria-keyshortcuts': string;
    'data-zoomed'?: '';
    'data-dragging'?: '';
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    onDoubleClick: (e: ReactMouseEvent<HTMLElement>) => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  };
  /** The frame's transform away from fit; undefined at fit, where the layout is the truth. */
  frameStyle: CSSProperties | undefined;
  zoomed: boolean;
  label: string;
  atFit: boolean;
  atFill: boolean;
  atActual: boolean;
  canIn: boolean;
  canOut: boolean;
  toFit: () => void;
  toFill: () => void;
  toActual: () => void;
  to: (percent: number) => void;
  stepIn: () => void;
  stepOut: () => void;
}

/**
 * Zooming the picture where it is.
 *
 * The stage's own layout decides the fit (the frame's width over the
 * picture's pixels), so at fit nothing is transformed and nothing can drift.
 * From there: the wheel, with or without ctrl, a trackpad pinch or two
 * fingers zoom about the cursor, the way an image viewer reads a wheel; a
 * drag or one finger pans when the picture runs past its row; a double
 * click or double tap goes to actual size and back; plus, minus, 0 and 1 do
 * the same from the keyboard. Fill covers the row, 100% is the picture at
 * its own pixel size, and the range ends at three times that.
 *
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
  const l = frame && viewport && natural ? limits(frame.fit, viewport, natural) : null;

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
    // fit is the layout's own place, wherever the last tick left the picture
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
  const centre = (): Pt => ({ x: (vpRef.current?.w ?? 0) / 2, y: (vpRef.current?.h ?? 0) / 2 });
  const zoomStep = (dir: 1 | -1, at?: Pt) => {
    const n = nums();
    if (!n) return;
    const p = at ?? centre();
    go(zoomBy(n.v, dir > 0 ? STEP : 1 / STEP, p.x, p.y, n.vp, n.nat, n.lim), true);
  };
  const toScale = (scale: number) => {
    const n = nums();
    if (!n) return;
    const c = centre();
    go(zoomTo(n.v, scale, c.x, c.y, n.vp, n.nat, n.lim), true);
  };
  const toFit = () => {
    const f = frameRef.current;
    if (!f) return;
    go({ scale: f.fit, tx: f.ox, ty: f.oy }, true);
    userZoomed.current = false;
  };
  const toFill = () => {
    const n = nums();
    if (n) toScale(n.lim.fill);
  };
  const toActual = () => {
    const n = nums();
    if (n) toScale(n.lim.actual);
  };
  const to = (percent: number) => {
    const n = nums();
    if (n) toScale((percent / 100) * n.lim.actual);
  };
  const toggle = (at: Pt) => {
    const n = nums();
    if (!n) return;
    const target = toggleTarget(n.v.scale, n.lim);
    if (isFit(target, n.lim)) toFit();
    else go(zoomTo(n.v, target, at.x, at.y, n.vp, n.nat, n.lim), true);
  };
  const zoomedNow = () => {
    const n = nums();
    return !!n && !isFit(n.v.scale, n.lim);
  };

  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; at: Pt } | null>(null);
  const lastType = useRef<string>('mouse');
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = viewEl?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    lastType.current = e.pointerType;
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
      return { p, tap: false };
    }
    gesture.current = null;
    setDragging(false);
    return { p, tap: g?.kind === 'drag' && g.moved <= DRAG_PX && e.pointerType !== 'mouse' };
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const { p, tap } = release(e);
    if (!tap || !p) return;
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
  const onDoubleClick = (e: ReactMouseEvent<HTMLElement>) => {
    // a touch double tap is handled above; Chrome fires dblclick for it too
    if (lastType.current === 'mouse') toggle(local(e));
  };

  // Wheel is a native listener: React's is passive, and this one has to stop
  // the page. A wheel over the picture is a zoom about the cursor, ctrl or
  // no ctrl (a trackpad pinch arrives as a wheel with ctrlKey); a notch is a
  // step of about a third, a trackpad's run of small deltas is smooth.
  useEffect(() => {
    const el = viewEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const n = nums();
      if (!n) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      const dy = Math.max(-40, Math.min(40, e.deltaY * unit));
      const r = el.getBoundingClientRect();
      go(zoomBy(n.v, Math.exp(-dy * 0.008), e.clientX - r.left, e.clientY - r.top, n.vp, n.nat, n.lim), false);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewEl, go]);

  // Zoom keys are the picture's. The arrows are its only when it is zoomed;
  // at fit they fall through to the overlay, which walks shots on them.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const pan = (dx: number, dy: number) => {
      const n = nums();
      if (n) go(panBy(n.v, dx, dy, n.vp, n.nat), true);
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
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!zoomedNow()) return;
        const dx = e.key === 'ArrowLeft' ? KEY_PAN : e.key === 'ArrowRight' ? -KEY_PAN : 0;
        const dy = e.key === 'ArrowUp' ? KEY_PAN : e.key === 'ArrowDown' ? -KEY_PAN : 0;
        pan(dx, dy);
        break;
      }
      default:
        return;
    }
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
      'aria-keyshortcuts': '+ - 0 1',
      'data-zoomed': zoomed ? '' : undefined,
      'data-dragging': dragging ? '' : undefined,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onDoubleClick,
      onKeyDown,
    },
    frameStyle,
    zoomed,
    label: view && l ? zoomLabel(view.scale, l) : 'Fit',
    atFit: !zoomed,
    atFill: !!(view && l && isFill(view.scale, l)),
    atActual: !!(view && l && isActual(view.scale, l)),
    canIn: !!(view && l && view.scale < l.max * 0.999),
    canOut: !!(view && l && view.scale > l.min * 1.001),
    toFit,
    toFill,
    toActual,
    to,
    stepIn: () => zoomStep(1),
    stepOut: () => zoomStep(-1),
  };
}
