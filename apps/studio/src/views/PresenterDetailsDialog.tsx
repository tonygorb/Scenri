import { useState } from 'react';
import type { PresenterPatch } from '../api.js';
import { CategoryMenu } from '../create/presenter/CategoryMenu.js';
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
  const [draftDescriptor, setDescriptor] = useState(descriptor);
  const [draftCategories, setCategories] = useState(categories);

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
        <label className="sc-pdetails-row">
          <span className="sc-pdetails-lb">Caption</span>
          <input
            className="sc-pdetails-field"
            value={draftDescriptor}
            dir="auto"
            placeholder="A short line for their card"
            onChange={(e) => setDescriptor(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <span className="sc-pdetails-hint">Shown under their name, and on their card in the library.</span>
        </label>
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

/** The same glyph the other sheets close with. */
function CloseGlyph() {
  return <span aria-hidden>{'×'}</span>;
}
