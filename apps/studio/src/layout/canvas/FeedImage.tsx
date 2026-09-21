import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * Srcs this session has already decoded. Masonry remounts a tile when it hops
 * column (an archive redistributes; the assets rail changing width recounts
 * columns), and a remount used to replay the fade-in: `loaded` started false,
 * `loading="lazy"` delayed the cached decode, and the picture went to opacity
 * 0 for a painted frame. Remembering the src is what lets the next mount load
 * eagerly and call itself ready in `useLayoutEffect`, before paint.
 */
const ready = new Set<string>();

export function feedImageIsReady(src: string): boolean {
  return ready.has(src);
}

export function markFeedImageReady(src: string): void {
  if (src) ready.add(src);
}

/**
 * A feed picture that holds its own space until it can actually be seen.
 *
 * The shot that just finished is the one moment the app has no cached copy of
 * the picture: the shimmer used to unmount in the same commit that mounted the
 * image, so the tile went blank for the whole decode of a full resolution PNG
 * and then snapped. Here the shimmer stays until the browser says the pixels
 * are ready, the box keeps the brief's own shape while it waits, and the image
 * fades in rather than appearing mid-scroll.
 *
 * The callback ref is not decoration: a cached image can finish loading before
 * React attaches its onLoad, and without the `complete` check that picture
 * would never be marked loaded and never become visible. `useLayoutEffect`
 * repeats that check so a remount of an already-decoded src does not paint
 * the fade.
 */
export function FeedImage({
  src,
  fallback,
  alt = '',
  aspect,
  guess = true,
}: {
  src: string;
  /**
   * What to show when `src` cannot load: the original behind a derivative,
   * so a tile whose thumbnail is missing is a slower tile, never a broken one.
   */
  fallback?: string;
  alt?: string;
  aspect?: number;
  /**
   * True when `aspect` came from the brief's format rather than from recorded
   * pixels. A guessed box still hands control back to the image once it loads,
   * so a shot whose real shape differs self-corrects; a measured box never
   * needs to, and holding it is what keeps the column from reflowing.
   */
  guess?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const shown = failed && fallback ? fallback : src;
  const [loaded, setLoaded] = useState(false);
  const [current, setCurrent] = useState(shown);
  if (shown !== current) {
    setCurrent(shown);
    setLoaded(false);
  }
  const imgRef = useRef<HTMLImageElement | null>(null);
  const becomeReady = useCallback(() => {
    markFeedImageReady(shown);
    setLoaded(true);
  }, [shown]);
  const measure = useCallback(
    (el: HTMLImageElement | null) => {
      imgRef.current = el;
      if (el?.complete && el.naturalWidth) becomeReady();
    },
    [becomeReady],
  );
  useLayoutEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth) becomeReady();
  }, [becomeReady]);
  const cached = feedImageIsReady(shown);
  return (
    <span
      className="sc-cellimg"
      data-loaded={loaded || undefined}
      data-cached={cached || undefined}
      data-guess={guess || undefined}
      style={aspect ? ({ '--sc-cell-ar': aspect } as CSSProperties) : undefined}
    >
      {!loaded && !cached && <span className="sc-shimmer" />}
      <img
        ref={measure}
        src={shown}
        alt={alt}
        loading={cached ? 'eager' : 'lazy'}
        decoding={cached ? 'sync' : 'async'}
        onLoad={() => becomeReady()}
        onError={() => {
          if (fallback && !failed) setFailed(true);
          else becomeReady();
        }}
      />
    </span>
  );
}
