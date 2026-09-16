import { useId, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';
import { panelStyle, placePanel, type Placed } from '../composer/anchorPanel.js';
import { Tip } from './Tip.js';

/**
 * One stop of a page tour (DESIGN.md, "First use"): a quiet spotlight on a real
 * control and a small card beside it. Nothing here is modal. The spotlight
 * takes no clicks, focus stays where the person left it, and the control under
 * the light works as it always does, which is how many stops move on.
 *
 * It owns no product logic: TourHost decides which stop is showing and what
 * moves it; this only draws it where the control actually is.
 */
export function Tour({
  target,
  clearOf,
  index,
  total,
  title,
  body,
  onNext,
  onSkip,
}: {
  target: HTMLElement | null;
  /** Something the card must also stay clear of, such as the composer card around the +. */
  clearOf?: HTMLElement | null;
  index: number;
  total: number;
  title: string;
  body: string;
  onNext: () => void;
  onSkip: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const [box, setBox] = useState<{ rect: DOMRect; radius: string; pos: Placed } | null>(null);

  useLayoutEffect(() => {
    if (!target) {
      setBox(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        const vv = window.visualViewport;
        const vp = { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight };
        const outer = clearOf?.getBoundingClientRect();
        const anchor = outer
          ? {
              left: rect.left,
              right: rect.right,
              top: Math.min(rect.top, outer.top),
              bottom: Math.max(rect.bottom, outer.bottom),
            }
          : rect;
        const pos = placePanel(anchor, vp, { width: 300, gap: 12 });
        setBox(pos ? { rect, radius: getComputedStyle(target).borderRadius, pos } : null);
      });
    };
    // A target below the fold is brought up once, when its stop opens.
    const r = target.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(target);
    if (clearOf) ro.observe(clearOf);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [target, clearOf]);

  if (!box) return null;
  const last = index === total - 1;
  const style = panelStyle(box.pos);
  return createPortal(
    <>
      <div className="sc-tour-light" aria-hidden="true" style={light(box.rect, box.radius)} />
      <div
        className="sc-tour"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-side={box.pos.side}
        style={{ left: style.left, width: style.width, top: style.top, bottom: style.bottom }}
      >
        <div className="sc-tour-head">
          <h2 id={titleId} className="sc-tour-title">
            {title}
          </h2>
          <Tip label="Skip tour">
            <button type="button" className="sc-icon-btn sc-tour-x" aria-label="Skip tour" onClick={onSkip}>
              <X size={13} />
            </button>
          </Tip>
        </div>
        <p id={bodyId} className="sc-tour-body">
          {body}
        </p>
        <div className="sc-tour-foot">
          <button type="button" className="sc-tour-skip" onClick={onSkip}>
            Skip tour
          </button>
          <span className="sc-tour-count">
            {index + 1} of {total}
          </span>
          <button type="button" className="sc-btn sc-btn-primary sc-tour-next" onClick={onNext}>
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/**
 * The light's box: the target plus a little air, kept on screen, so a control
 * against the top bar or a wall taller than the window is still ringed rather
 * than cut off by the edge.
 */
function light(rect: DOMRect, radius: string) {
  const PAD = 6;
  const EDGE = 2;
  const left = Math.max(EDGE, rect.left - PAD);
  const top = Math.max(EDGE, rect.top - PAD);
  const right = Math.min(window.innerWidth - EDGE, rect.right + PAD);
  const bottom = Math.min(window.innerHeight - EDGE, rect.bottom + PAD);
  return { left, top, width: right - left, height: bottom - top, borderRadius: `calc(${radius} + ${PAD}px)` };
}
