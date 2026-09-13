import { useState } from 'react';
import type { PresenterPatch } from '../api.js';
import { ChipPicker } from '../layout/ChipPicker.js';
import { DialogSheet, SheetClose, SheetTitle } from '../layout/DialogSheet.js';

/**
 * The words on a presenter's record, changed in one place.
 *
 * A name, and two lists of short words. The two lists are the same control
 * and differ only in the words it offers: the phrases this brand already
 * describes people by, or the categories it already files them under. They
 * were three controls borrowed from three other surfaces once, and it showed.
 *
 * The description is edited as what it is. Every descriptor Scenri writes is
 * three phrases with an interpunct between them, so it was a list stored as a
 * string all along, and a single text field made the reader guess the
 * separator and retype the line to change one word.
 *
 * Not to be confused with Edit presenter, which opens the studio and changes
 * what they look like. Nothing here touches a picture.
 */
export function PresenterDetailsDialog({
  name,
  descriptor,
  categories,
  known,
  phrases,
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
  /** Phrases the brand's other presenters are described by, offered first. */
  phrases: string[];
  busy?: boolean;
  error?: string | null;
  onSave: (patch: PresenterPatch) => void;
  onDismiss: () => void;
}) {
  const [draftName, setName] = useState(name);
  const [traits, setTraits] = useState(() => splitCaption(descriptor));
  const [draftCategories, setCategories] = useState(categories);

  const draftDescriptor = traits.join(CAPTION_SEP);

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
            <span aria-hidden>{'×'}</span>
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
          <span className="sc-pdetails-lb">Description</span>
          <ChipPicker
            value={traits}
            onChange={setTraits}
            options={phrases}
            label="Description"
            placeholder="Athletic build"
            findPlaceholder="Find or add a phrase"
            emptyNote="No phrase by that name yet."
            max={6}
            maxLength={40}
          />
          <span className="sc-pdetails-hint">
            {draftDescriptor ? (
              <>
                Reads as <b>{draftDescriptor}</b> under their name.
              </>
            ) : (
              'A few phrases. Together they are the line under their name.'
            )}
          </span>
        </div>

        <div className="sc-pdetails-row">
          <span className="sc-pdetails-lb">Categories</span>
          <ChipPicker
            value={draftCategories}
            onChange={setCategories}
            options={known}
            label="Categories"
            placeholder="Any"
            findPlaceholder="Find or add a category"
            emptyNote="Nothing by that name."
            maxLength={30}
          />
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
const CAPTION_SEP = ' · ';
export const splitCaption = (caption: string): string[] =>
  caption
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean);
