import { useCallback, useState, type CSSProperties } from 'react';

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
 * would never be marked loaded and never become visible.
 */
export function FeedImage({
  src,
  alt = '',
  aspect,
  guess = true,
}: {
  src: string;
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
  const [loaded, setLoaded] = useState(false);
  const measure = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete) setLoaded(true);
  }, []);
  return (
    <span
      className="sc-cellimg"
      data-loaded={loaded || undefined}
      data-guess={guess || undefined}
      style={aspect ? ({ '--sc-cell-ar': aspect } as CSSProperties) : undefined}
    >
      {!loaded && <span className="sc-shimmer" />}
      <img
        ref={measure}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </span>
  );
}
