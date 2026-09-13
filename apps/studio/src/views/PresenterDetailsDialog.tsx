import { useState } from 'react';
import type { PresenterPatch } from '../api.js';
import { CategoryMenu } from '../create/presenter/CategoryMenu.js';
import { ChipsInput } from '../layout/ChipsInput.js';
import { DialogSheet, SheetClose, SheetTitle } from '../layout/DialogSheet.js';

/**
 * The words on a presenter's record, changed in one place.
 *
 * These used to be fields standing in for the heading and the caption, so a
 * saved person read as a half-filled form and the page could not say what was
 * a title and what was an input. They are details, they are edited rarely,
 * and they cost nothing to generate, so they belong behind one quiet verb
 * rather than in the shape of the page.
 *
 * The caption is edited as what it is: every descriptor Scenri writes is
 * three phrases with an interpunct between them, so it is a list stored as a
 * string, and a single text field made the reader guess the separator. The
 * phrases are chips; the caption they compose is shown back underneath.
 *
 * Not to be confused with Edit presenter, which opens the studio and changes
 * what they look like. Nothing here touches a picture.
 */
export function PresenterDetailsDialog({
  name,
  descriptor,
  categories,
  known,
  busy,
  error,
  onSave,
  onDismiss,
}: {
  name: string;
  descriptor: string;
  categories: string[];
  /** Every category this brand already files presenters under. */
  known: string[];
  busy?: boolean;
  error?: string | null;
  onSave: (patch: PresenterPatch) => void;
  onDismiss: () => void;
}) {
  const [draftName, setName] = useState(name);
  const [traits, setTraits] = useState(() => splitCaption(descriptor));
  const [draftCategories, setCategories] = useState(categories);

  // The caption is these traits, joined. It is not a second field: every
  // descriptor in the library is already three phrases with an interpunct
  // between them, so the string was a list all along and only ever looked
  // like prose because it was edited as one.
  const draftDescriptor = traits.join(CAPTION_SEP);
  // The server keeps 120 characters of it. Rather than let it cut what was
  // typed, the list simply stops accepting more once the caption is full.
  const room = draftDescriptor.length < CAPTION_MAX - 12 && traits.length < 6;

  const trimmed = draftName.trim();
  // A name is theirs to choose, so anything with a character in it stands.
  const ready = trimmed.length > 0;
  const changed =
    trimmed !== name.trim() ||
    draftDescriptor.trim() !== descriptor.trim() ||
    draftCategories.join(' ') !== categories.join(' ');

  const submit = () => {
    if (!ready || busy) return;
    if (!changed) return onDismiss();
    onSave({ name: trimmed, descriptor: draftDescriptor.trim(), suitableCategories: draftCategories });
  };

  return (
    <DialogSheet className="sc-newdlg sc-pdetails" maxWidth="min(460px, 94vw)" onDismiss={onDismiss}>
      <div className="sc-newdlg-head">
        <SheetTitle className="sc-newdlg-title">Details</SheetTitle>
        <SheetClose asChild>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <CloseGlyph />
          </button>
        </SheetClose>
      </div>
      <div className="sc-newdlg-body">
        <label className="sc-pdetails-row">
          <span className="sc-pdetails-lb">Name</span>
          <input
            className="sc-pdetails-field"
            value={draftName}
            dir="auto"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        <div className="sc-pdetails-row">
          <span className="sc-pdetails-lb">What describes them</span>
          <ChipsInput
            value={traits}
            onChange={setTraits}
            label="What describes them"
            placeholder={traits.length ? 'Add another' : 'Athletic build'}
            max={room ? 6 : traits.length}
            maxLength={40}
          />
          <span className="sc-pdetails-hint">
            {draftDescriptor ? (
              <>
                Their caption reads <b>{draftDescriptor}</b>
              </>
            ) : (
              'One phrase at a time. Together they are the caption under their name, and on their card.'
            )}
          </span>
        </div>
        <div className="sc-pdetails-row">
          <span className="sc-pdetails-lb">Filed under</span>
          <CategoryMenu value={draftCategories} categories={known} onChange={setCategories} placeholder="Nothing yet" />
          <span className="sc-pdetails-hint">The verticals they suit, so they surface where you work.</span>
        </div>
        {error && <p className="sc-assetform-err">{error}</p>}
      </div>
      <div className="sc-newdlg-foot">
        <button type="button" className="sc-btn sc-btn-ghost" onClick={onDismiss}>
          Cancel
        </button>
        <button
          type="button"
          className="sc-btn sc-btn-primary"
          disabled={!ready}
          data-busy={busy || undefined}
          onClick={submit}
        >
          {busy ? 'Saving' : 'Save'}
        </button>
      </div>
    </DialogSheet>
  );
}

/** How a caption is written down, and how it comes apart again. */
const CAPTION_SEP = ' \u00b7 ';
const CAPTION_MAX = 120;
export const splitCaption = (caption: string): string[] =>
  caption
    .split('\u00b7')
    .map((part) => part.trim())
    .filter(Boolean);

/** The same glyph the other sheets close with. */
function CloseGlyph() {
  return <span aria-hidden>{'×'}</span>;
}
