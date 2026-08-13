import { useLayoutEffect, useRef, useState } from 'react';
import { Spinner } from '@radix-ui/themes';
import { CaretLeft, CaretRight, ImageSquare, Plus } from '@phosphor-icons/react';
import { imgUrl, nodeLabel, type TreeNode } from '../api.js';

/**
 * Shared between `ScenePage` and `PresenterPage`: the reference-frame grid,
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

/**
 * One recommended angle a product hasn't got yet — a single upload-capable
 * tile, for the per-category reference checklist on a product's page.
 * Distinct from `EmptyRefFrame` below, which fills in for having no
 * reference at all rather than naming one specific missing shot.
 */
export function UploadRefFrame({
  label,
  busy,
  onUpload,
}: {
  label: string;
  busy?: boolean;
  onUpload: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <label className="sc-lookpage-ref sc-lookpage-ref-upload" data-busy={busy || undefined}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = '';
        }}
      />
      <span className="sc-lookpage-ref-blank">{busy ? <Spinner size="2" /> : <Plus size={18} />}</span>
      <span className="sc-lookpage-ref-upload-label">{label}</span>
    </label>
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
    <button type="button" className="sc-lookcard" aria-label={`Open ${nodeLabel(node)}`} onClick={onClick}>
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

/** A row that keeps going: the run is cloned once and the seam is invisible.
 * Edge fades match VerticalsTabs — soft, scroll-aware, only when clipped. */
export function Slider({ label, children }: { label: string; children: React.ReactNode }) {
  const shell = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const placeFadesRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const s = shell.current;
    const t = track.current;
    if (!s || !t) return;

    let fadeRaf = 0;
    const placeFades = () => {
      const max = t.scrollWidth - t.clientWidth;
      if (max <= 1) {
        delete s.dataset.overflowLeft;
        delete s.dataset.overflowRight;
        return;
      }
      if (t.scrollLeft > 2) s.dataset.overflowLeft = '';
      else delete s.dataset.overflowLeft;
      if (t.scrollLeft < max - 2) s.dataset.overflowRight = '';
      else delete s.dataset.overflowRight;
    };
    placeFadesRef.current = placeFades;
    placeFades();

    const onScroll = () => {
      if (fadeRaf) return;
      fadeRaf = requestAnimationFrame(() => {
        fadeRaf = 0;
        placeFades();
      });
    };

    const ro = new ResizeObserver(() => placeFades());
    ro.observe(t);
    t.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (fadeRaf) cancelAnimationFrame(fadeRaf);
      placeFadesRef.current = () => {};
      ro.disconnect();
      t.removeEventListener('scroll', onScroll);
    };
  }, []);

  const slide = (dir: 1 | -1) => {
    const t = track.current;
    if (!t?.firstElementChild || busy.current) return;
    const step = (t.firstElementChild as HTMLElement).getBoundingClientRect().width + 16;
    const run = t.scrollWidth / 2;
    if (dir < 0 && t.scrollLeft < step) t.scrollLeft += run; // hop into the clone first
    const from = t.scrollLeft,
      delta = dir * step,
      start = performance.now();
    busy.current = true;
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / 420);
      t.scrollLeft = from + delta * (1 - (1 - p) ** 3);
      placeFadesRef.current();
      if (p < 1) requestAnimationFrame(frame);
      else {
        busy.current = false;
        if (t.scrollLeft >= run) t.scrollLeft -= run;
        placeFadesRef.current();
      }
    };
    requestAnimationFrame(frame);
  };

  return (
    <section className="sc-lookpage-band">
      <p className="sc-bandhead">{label}</p>
      <div className="sc-slider" ref={shell}>
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
