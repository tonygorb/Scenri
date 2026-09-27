import { useCallback, useRef, useState } from 'react';
import { Arrival } from './Arrival.js';
import { prefersStill } from './tones.js';

/**
 * Steps seen rendering in a small thumbnail (the trail under the stage, the
 * rail beside it), so the one that lands there lands in the same box rather
 * than cutting to the picture. Adding to it while rendering is idempotent, so
 * StrictMode's second render changes nothing; it is cleared when the landing
 * ends.
 */
const ranInThumb = new Set<string>();

/** Marks a step as seen rendering in a thumbnail; draws nothing. */
export function RenderingMark({ id }: { id: string }) {
  ranInThumb.add(id);
  return null;
}

/**
 * A finished step's thumbnail. Just landed from a step seen rendering: the
 * picture in the same box the rendering stood in, landing over it; after
 * that, and for every other step, the plain thumbnail, which by then is the
 * same picture, decoded.
 */
export function LandingThumb({ id, src, active }: { id: string; src: string; active: boolean }) {
  const img = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [, settle] = useState(0);
  const end = useCallback(() => {
    ranInThumb.delete(id);
    settle((x) => x + 1);
  }, [id]);
  if (!ranInThumb.has(id) || prefersStill())
    return (
      <img
        src={src}
        alt=""
        className="sc-thumb"
        loading="lazy"
        decoding="async"
        data-active={active}
        width={52}
        height={52}
      />
    );
  return (
    <span className="sc-thumb sc-thumb-wait" data-active={active}>
      <img
        ref={(el) => {
          img.current = el;
          if (el?.complete && el.naturalWidth && !loaded) setLoaded(true);
        }}
        src={src}
        alt=""
        className="sc-thumb-landing"
        decoding="async"
        onLoad={() => setLoaded(true)}
      />
      <Arrival img={img} ready={loaded} onDone={end} />
    </span>
  );
}
