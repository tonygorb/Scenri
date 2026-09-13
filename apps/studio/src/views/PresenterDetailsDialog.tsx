import { useState } from 'react';
import type { PresenterPatch } from '../api.js';
import { ChipPicker } from '../layout/ChipPicker.js';
import { DialogSheet, SheetClose, SheetTitle } from '../layout/DialogSheet.js';

/**
 * The words on a presenter's record, changed in one place.
 *
 * Two things, and only the two that are actually yours: what they are called,
 * and what you file them under.
 *
 * The caption under their name is not here, and was briefly. Creation never
 * asks for it: the analyser writes it from the face it drew or the
 * photographs it read, and it is then used as a label wherever the person
 * appears. Offering it as a list to curate asked for work nobody signed up
 * for and implied it was the reader's sentence to write. If it is wrong, the
 * person is what to change, and it is rewritten with them.
 *
 * Not to be confused with Edit presenter, which opens the studio and changes
 * what they look like. Nothing here touches a picture.
 */
export function PresenterDetailsDialog({
  name,
  categories,
  known,
  busy,
  error,
  onSave,
  onDismiss,
}: {
  name: string;
  categories: string[];
  /** Every category this brand already files presenters under. */
  known: string[];
  busy?: boolean;
  error?: string | null;
  onSave: (patch: PresenterPatch) => void;
  onDismiss: () => void;
}) {
  const [draftName, setName] = useState(name);
  const [draftCategories, setCategories] = useState(categories);

  const trimmed = draftName.trim();
  // A name is theirs to choose, so anything with a character in it stands.
  const ready = trimmed.length > 0;
  const changed = trimmed !== name.trim() || draftCategories.join(' ') !== categories.join(' ');

  const submit = () => {
    if (!ready || busy) return;
    if (!changed) return onDismiss();
    onSave({ name: trimmed, suitableCategories: draftCategories });
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
