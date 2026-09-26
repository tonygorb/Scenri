import { useCallback, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowSquareOut, ArrowsOutSimple, X } from '@phosphor-icons/react';
import type { ReleaseEntry } from '../api.js';
import { focusSelfOnOpen } from '../app/dialogs.js';
import fallbackArt from '../assets/whatsnew-fallback.svg';
import { readableDate } from '../release.js';
import { pictureUrl } from '../whatsNewPictures.js';

/**
 * The pieces the What's New dialog and page share, so one update reads the
 * same in both: its picture, its date and version, the way to its release
 * notes, and the sentences for a history that could not be read or has
 * nothing in it.
 */

export const FAILED =
  'Scenri could not read its release notes. If you are running a development server, it may predate this page; restart it and try again.';
export const NOTHING_YET = 'There is nothing new to show here yet.';
/** No headline to introduce, but small updates to read: the dialog points at them. */
export const ON_THE_PAGE = "The recent updates are small ones, and they are on the What's New page.";

/** A release's picture, resolved to the file this build ships. */
export interface WhatsNewPic {
  src: string;
  alt: string;
}

/**
 * A release's one picture: never a hidden set, so a big release gets a smarter
 * picture rather than more of them (the record's validator allows one). Null
 * when it has none, or names a file this build does not carry: then the
 * release reads as words alone.
 */
export function pictureOf(entry: ReleaseEntry | null): WhatsNewPic | null {
  const image = entry?.sections.find((s) => s.image)?.image;
  const src = image ? pictureUrl(image.file) : null;
  return image && src ? { src, alt: image.alt } : null;
}

/**
 * A release's picture on the media stage.
 *
 * Every picture sits on the same stage, whatever its subject: the painted sky,
 * the picture inside it at its own proportions with the same margin all round,
 * never cropped and never stretched. The framing is the capture's job
 * (`apps/studio/capture/`): the stage only presents. The stage holds its shape
 * before the picture decodes and the picture fades in; one that fails leaves
 * nothing behind. Never the gold shimmer: that says work is in flight.
 *
 * With `onOpen` it is a button (the page: the picture larger). Without, it is
 * a still picture inside something that is already a link (the dialog's
 * excerpt), so one press never means two things.
 */
export function WhatsNewPicture({
  picture,
  eager = false,
  onOpen,
  onBroken,
}: {
  picture: WhatsNewPic;
  eager?: boolean;
  onOpen?: () => void;
  /** It failed to load: the dialog puts its fallback in its place, the page leaves no hole. */
  onBroken?: () => void;
}) {
  const [state, setState] = useState<'wait' | 'ready' | 'broken'>('wait');
  // A picture already decoded (the dialog preloads its own) can finish before
  // React attaches onLoad, and would then wait on the stage forever.
  const seen = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) setState('ready');
  }, []);
  if (state === 'broken') return null;
  const ready = state === 'ready' || undefined;
  const img = (
    <img
      ref={seen}
      src={picture.src}
      alt={picture.alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onLoad={() => setState('ready')}
      onError={() => {
        setState('broken');
        onBroken?.();
      }}
    />
  );
  return onOpen ? (
    <button type="button" className="sc-wn-media" data-ready={ready} aria-haspopup="dialog" onClick={onOpen}>
      {img}
      <span className="sc-vh">, view larger</span>
      {/* the scene page's corner control, as a mark: the whole stage is the button */}
      <span className="sc-wn-open" aria-hidden="true">
        <ArrowsOutSimple size={14} />
      </span>
    </button>
  ) : (
    <div className="sc-wn-media" data-ready={ready}>
      {img}
    </div>
  );
}

/**
 * The picture larger, and nothing else: no caption, no buttons, no stepping,
 * because the page already says everything the picture is for. The app's
 * scrim, and the stage itself (the sky and the picture on it, one image, as
 * the page shows it) as large as the window allows; a press anywhere or
 * Escape closes it. The close button exists for the keyboard
 * and a screen reader, and shows only when the keyboard is on it. Named by the
 * picture's own sentence.
 */
export function WhatsNewLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  // Radix hands focus back to a trigger, and this opens from state with none:
  // without this the keyboard would be left on the page's body when it closes.
  const back = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="sc-wn-lb-scrim" />
        <Dialog.Content
          className="sc-wn-lb"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            back.current = document.activeElement as HTMLElement | null;
            focusSelfOnOpen(e);
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (back.current?.isConnected) back.current.focus();
          }}
          onClick={onClose}
        >
          <Dialog.Title className="sc-vh">{alt}</Dialog.Title>
          {/* the stage itself, larger: the sky and the picture as one image, as the page shows it */}
          <div className="sc-wn-media sc-wn-lb-stage" data-ready>
            <img src={src} alt={alt} />
          </div>
          <Dialog.Close className="sc-wn-lb-close" aria-label="Close">
            <X size={16} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The version a release went out as, as a traditional version tag: a pill with
 * the number and nothing else, a label and never a control. The version this
 * computer runs is the same tag lit (the chips' on-state fill), the way a
 * release list marks the one that matters to you (GitHub's "Latest"); the
 * colour says it, and a screen reader hears it in Settings' own words.
 */
export function VersionChip({ version, current = false }: { version: string; current?: boolean }) {
  return (
    <span className="sc-wn-chip" data-on={current || undefined}>
      <span className="sc-vh">Version </span>
      {version}
      {current && <span className="sc-vh">, the version you are on</span>}
    </span>
  );
}

/**
 * What a release changed, area by area: each area's name a small heading of
 * its own over its sentence. Run into the sentence, the name read twice
 * ("Codex Codex keeps no copy"); on its own line it is a label.
 */
export function ReleaseAreas({ sections }: { sections: { heading: string; body: string }[] }) {
  return (
    <div className="sc-wn-areas">
      {sections.map((s) => (
        <section key={s.heading} className="sc-wn-area">
          <h3>{s.heading}</h3>
          <p>{s.body}</p>
        </section>
      ))}
    </div>
  );
}

/** When and which version. `hideVersion` where the version is already on the picture (the fallback). */
export function ReleaseMeta({
  entry,
  current = false,
  hideVersion = false,
}: {
  entry: { version: string; date: string };
  current?: boolean;
  hideVersion?: boolean;
}) {
  return (
    <p className="sc-wn-when">
      <time dateTime={entry.date}>{readableDate(entry.date)}</time>
      {!hideVersion && <VersionChip version={entry.version} current={current} />}
    </p>
  );
}

/**
 * The dialog's picture for a release that has none of its own: Scenri's mark
 * on its own ground (the og-image, Figma node 5480:2, exported as vectors),
 * on the same stage as any picture, with the release's version on it as a
 * chip. It belongs to the dialog's first moment only: the page never shows it,
 * and the release still owns no picture. Decorative, so no text for a screen
 * reader beyond the version the chip says; not a lightbox either.
 */
export function WhatsNewFallback({ version, current }: { version: string; current: boolean }) {
  return (
    <div className="sc-wn-media sc-wn-fallback" data-ready>
      <img src={fallbackArt} alt="" />
      {/* the artwork is dark in either theme, so its chip wears the dark tokens */}
      <span className="sc-wn-fallback-chip" data-theme="dark">
        <VersionChip version={version} current={current} />
      </span>
    </div>
  );
}

/** One version's full notes on GitHub: every fix the record left out. */
export function ReleaseNotesLink({ href, version }: { href: string; version: string }) {
  return (
    <a className="sc-wn-notes" href={href} target="_blank" rel="noopener noreferrer">
      Release notes
      <span className="sc-vh"> for {version} on GitHub, opens in a new tab</span>
      <ArrowSquareOut size={12} aria-hidden="true" />
    </a>
  );
}
