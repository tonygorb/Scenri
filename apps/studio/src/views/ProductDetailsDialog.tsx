import { useState } from 'react';
import type { ProductSize } from '../api.js';
import { DialogSheet, SheetClose, SheetTitle } from '../layout/DialogSheet.js';

/**
 * A product's facts, changed in one place, the way a presenter's and a
 * scene's are: the same Details sheet behind the same pencil.
 *
 * Only its size for now. Nobody is asked for it: it is read from the product's
 * photograph the first time it is needed, and shown on the page. This is where
 * a wrong reading is put right, in the words a shop would use; left empty, the
 * reading (or the store's own listing) stands again.
 */
export function ProductDetailsDialog({
  size,
  busy,
  error,
  onSave,
  onDismiss,
}: {
  size: ProductSize | null;
  busy?: boolean;
  error?: string | null;
  onSave: (size: string) => void;
  onDismiss: () => void;
}) {
  const current = size?.by === 'person' ? size.text : '';
  const [draft, setDraft] = useState(current);
  const trimmed = draft.trim();

  const submit = () => {
    if (busy) return;
    if (trimmed === current) return onDismiss();
    onSave(trimmed);
  };

  const hint =
    size?.by === 'person'
      ? 'Yours. Leave it empty to go back to the size read from its photo.'
      : size?.by === 'record'
        ? `From your store's listing. Write another to use yours instead.`
        : size
          ? 'Read from its photo, so a shot keeps it at its real size. Correct it if it is off.'
          : 'Not read yet. Write it the way a shop lists it.';

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
          <span className="sc-pdetails-lb">Size</span>
          <input
            className="sc-pdetails-field"
            value={draft}
            placeholder={size && size.by !== 'person' ? size.text : 'About 2 cm across, or 30 x 20 cm'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <span className="sc-pdetails-hint">{hint}</span>
        </label>

        {error && <p className="sc-assetform-err">{error}</p>}
      </div>

      <div className="sc-newdlg-foot">
        <button type="button" className="sc-btn sc-btn-ghost" onClick={onDismiss}>
          Cancel
        </button>
        <button type="button" className="sc-btn sc-btn-primary" data-busy={busy || undefined} onClick={submit}>
          {busy ? 'Saving' : 'Save'}
        </button>
      </div>
    </DialogSheet>
  );
}
