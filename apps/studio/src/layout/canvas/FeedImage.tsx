import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ImageSquare } from '@phosphor-icons/react';
import { markPictureReady, pictureIsReady } from '../pictureReady.js';

/**
 * Srcs this session has already decoded. Masonry remounts a tile when it hops
 * column (an archive redistributes; the assets rail changing width recounts
 * columns), and a remount used to replay the fade-in: `loaded` started false,
 * `loading="lazy"` delayed the cached decode, and the picture went to opacity
 * 0 for a painted frame. Remembering the src is what lets the next mount load
 * eagerly and call itself ready in `useLayoutEffect`, before paint. The set is
 * the one every picture in the studio shares (`pictureReady.ts`).
 */
export const feedImageIsReady = pictureIsReady;
export const markFeedImageReady = markPictureReady;

/**
 * A feed picture that holds its own space until it can actually be seen.
 *
 * The shot that just finished is the one moment the app has no cached copy of
 * the picture: the tile used to go blank for the whole decode of a full
 * resolution PNG and then snap. Here the placeholder stays until the browser
 * says the pixels are ready, the box keeps the brief's own shape while it
 * waits, and the image fades in rather than appearing mid-scroll. Loading a
 * picture that exists is not making one, so this is the still placeholder,
 * never the generation band. A picture that cannot load at all keeps its box
 * and says so with the blank glyph, rather than being called loaded and
 * leaving an invisible hole.
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
  const [broken, setBroken] = useState(false);
  const [current, setCurrent] = useState(shown);
  if (shown !== current) {
    setCurrent(shown);
    setLoaded(false);
    setBroken(false);
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
      data-broken={broken || undefined}
      style={aspect ? ({ '--sc-cell-ar': aspect } as CSSProperties) : undefined}
    >
      {broken ? (
        <ImageSquare className="sc-cellimg-broken" size={24} weight="regular" aria-hidden />
      ) : (
        <>
          {!loaded && !cached && <span className="sc-placeholder" />}
          <img
            ref={measure}
            src={shown}
            alt={alt}
            loading={cached ? 'eager' : 'lazy'}
            decoding={cached ? 'sync' : 'async'}
            onLoad={() => becomeReady()}
            onError={() => {
              if (fallback && !failed) setFailed(true);
              else setBroken(true);
            }}
          />
        </>
      )}
    </span>
  );
}
