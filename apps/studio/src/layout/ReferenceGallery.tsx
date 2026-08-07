import { useRef, useState } from 'react';
import { CaretLeft, CaretRight, ImageSquare } from '@phosphor-icons/react';
import { imgUrl, nodeLabel, type TreeNode } from '../api.js';

/**
 * Shared between `LookPage` and `PresenterPage`: the reference-frame grid,
 * its empty state, the "made/featured with this" shot slider, and the
 * looping slider shell both pages built independently. One copy, one
 * broken-image fallback, one slide-animation implementation.
 */

/** One reference frame. A 404 reads the same as never having had one: the
 * blank box, not a broken-image glyph the browser drew on its own. */
export function RefFrame({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="sc-lookpage-ref">
      {broken ? (
        <span className="sc-lookpage-ref-blank">
          <ImageSquare size={20} />
        </span>
      ) : (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
      )}
    </div>
  );
}

/** No reference frame at all — the same blank box a broken image falls back
 * to, rather than nothing where the visual identity should be. */
export function EmptyRefFrame() {
  return (
    <div className="sc-lookpage-refs">
      <div className="sc-lookpage-ref">
        <span className="sc-lookpage-ref-blank">
          <ImageSquare size={20} />
        </span>
      </div>
    </div>
  );
}

/** One shot in a "made/featuring this" slider — same broken-image fallback. */
export function ShotThumb({ node, onClick }: { node: TreeNode; onClick: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      className="sc-lookcard"
      title={node.prompt}
      aria-label={`Open ${nodeLabel(node)}`}
      onClick={onClick}
    >
      {broken ? (
        <span className="sc-lookcard-blank">
          <ImageSquare size={20} />
        </span>
      ) : (
        <img src={imgUrl(node.images[0])} alt="" loading="lazy" onError={() => setBroken(true)} />
      )}
    </button>
  );
}

/** A row that keeps going: the run is cloned once and the seam is invisible. */
export function Slider({ label, children }: { label: string; children: React.ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const slide = (dir: 1 | -1) => {
    const t = track.current;
    if (!t?.firstElementChild) return;
    const step = (t.firstElementChild as HTMLElement).getBoundingClientRect().width + 12;
    const run = t.scrollWidth / 2;
    if (dir < 0 && t.scrollLeft < step) t.scrollLeft += run; // hop into the clone first
    const from = t.scrollLeft,
      delta = dir * step,
      start = performance.now();
    busy.current = true;
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / 420);
      t.scrollLeft = from + delta * (1 - (1 - p) ** 3);
      if (p < 1) requestAnimationFrame(frame);
      else {
        busy.current = false;
        if (t.scrollLeft >= run) t.scrollLeft -= run;
      }
    };
    requestAnimationFrame(frame);
  };

  return (
    <section className="sc-lookpage-band">
      <p className="sc-bandhead">{label}</p>
      <div className="sc-slider">
        <button type="button" className="sc-slider-arrow prev" aria-label="Previous" onClick={() => slide(-1)}>
          <CaretLeft size={13} weight="bold" />
        </button>
        <button type="button" className="sc-slider-arrow next" aria-label="Next" onClick={() => slide(1)}>
          <CaretRight size={13} weight="bold" />
        </button>
        <div className="sc-slider-track" ref={track}>
          {children}
          {children}
        </div>
      </div>
    </section>
  );
}
