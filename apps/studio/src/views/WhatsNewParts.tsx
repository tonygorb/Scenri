import { useCallback, useState } from 'react';
import type { ReleaseEntry, ReleaseImage } from '../api.js';
import { readableDate } from '../release.js';
import { pictureUrl } from '../whatsNewPictures.js';

/**
 * The pieces the What's New dialog and page share, so one update reads the
 * same in both: its picture, its date and version, and the sentences for a
 * history that could not be read or has nothing in it.
 */

export const FAILED =
  'Scenri could not read its release notes. If you are running a development server, it may predate this page; restart it and try again.';
export const NOTHING_YET = 'There is nothing new to show here yet.';
/** No headline to introduce, but small updates to read: the dialog points at them. */
export const ON_THE_PAGE = "The recent updates are small ones, and they are on the What's New page.";

/** The first picture a headline update carries: the dialog's, and the lead row's first. */
export function heroOf(entry: ReleaseEntry | null): ReleaseImage | null {
  return entry?.sections.find((s) => s.image)?.image ?? null;
}

/**
 * The real app, as the update changed it. The well holds the picture's shape
 * before it decodes and the picture fades in over it; one that is missing or
 * fails leaves nothing behind, so the update reads as words alone. Never the
 * gold shimmer: that says work is in flight, and nothing here is.
 *
 * Key it by file at the call site, so a new picture starts from the well.
 */
export function WhatsNewPicture({ image, eager = false }: { image: ReleaseImage; eager?: boolean }) {
  const src = pictureUrl(image.file);
  const [state, setState] = useState<'wait' | 'ready' | 'broken'>('wait');
  // A picture already decoded (the dialog preloads its own) can finish before
  // React attaches onLoad, and would then wait on the well forever.
  const seen = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) setState('ready');
  }, []);
  if (!src || state === 'broken') return null;
  return (
    <figure className="sc-wn-pic" data-ready={state === 'ready' || undefined}>
      <img
        ref={seen}
        src={src}
        alt={image.alt}
        width={1280}
        height={800}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setState('ready')}
        onError={() => setState('broken')}
      />
    </figure>
  );
}

/** When and which version: quiet, and after what it says. */
export function ReleaseMeta({ entry }: { entry: ReleaseEntry }) {
  return (
    <p className="sc-wn-when">
      <time dateTime={entry.date}>{readableDate(entry.date)}</time>
      <span className="sc-wn-ver">
        <span className="sc-vh">Version </span>
        {entry.version}
      </span>
    </p>
  );
}
