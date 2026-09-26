import { useState } from 'react';
import type { ProductSize } from '../api.js';
import { CategoryPicker } from '../layout/CategoryPicker.js';
import { DialogSheet, SheetClose, SheetTitle } from '../layout/DialogSheet.js';
import { plain, readDims, SIZE_AXES, SIZE_LABEL, type SizeAxis, type SizeDims } from '../sizeChips.js';

const AXIS_WORD: Record<SizeAxis, string> = { height: 'tall', width: 'across', depth: 'deep' };

/** The words a changed measurement saves. Empty when every field is clear. */
function writeDims(dims: SizeDims): string {
  return SIZE_AXES.map((axis) => {
    const value = plain(dims[axis]);
    return value ? `${value} ${dims.unit} ${AXIS_WORD[axis]}` : '';
  })
    .filter(Boolean)
    .join(' and ');
}

function sameDims(a: SizeDims, b: SizeDims): boolean {
  return SIZE_AXES.every((axis) => plain(a[axis]) === plain(b[axis]));
}

/**
 * A product's facts, changed in one place, the way a presenter's and a
 * scene's are: the same Details sheet behind the same pencil.
 *
 * Its filing, and its size. Height, width and depth are each optional.
 * Left as they were read, the original words stay. Cleared, a correction
 * steps back and the reading stands again.
 */
export function ProductDetailsDialog({
  size,
  category,
  busy,
  error,
  onSave,
  onDismiss,
}: {
  size: ProductSize | null;
  category: string | null;
  busy?: boolean;
  error?: string | null;
  onSave: (next: { size: string; category: string }) => void;
  onDismiss: () => void;
}) {
  const filed = category ?? 'other';
  const shown = size?.text ?? '';
  const [read] = useState(() => readDims(shown));
  const [dims, setDims] = useState(read);
  const [draftCategory, setCategory] = useState(filed);
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const sizeOut = sameDims(dims, read) ? shown : writeDims(dims);

  const submit = () => {
    if (busy) return;
    if (same(sizeOut, shown) && draftCategory === filed) return onDismiss();
    onSave({ size: sizeOut, category: draftCategory });
  };

  const hint =
    size?.by === 'person'
      ? 'Yours. Clear it to go back to the size read from its photo.'
      : size?.by === 'record'
        ? "From your store's listing."
        : size
          ? 'Read from its photo.'
          : 'Not read yet.';

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
        <div className="sc-pdetails-row">
          <span className="sc-pdetails-lb">Category</span>
          <CategoryPicker value={draftCategory} onChange={setCategory} />
          <span className="sc-pdetails-hint">Where it is filed, so it surfaces with that kind of product.</span>
        </div>

        <div className="sc-pdetails-row">
          <span className="sc-pdetails-lb">Size</span>
          <div className="sc-size">
            {SIZE_AXES.map((axis) => (
              <label key={axis} className="sc-size-dim">
                <span className="sc-size-name">{SIZE_LABEL[axis]}</span>
                <span className="sc-size-box">
                  <input
                    className="sc-pdetails-field"
                    inputMode="decimal"
                    aria-label={SIZE_LABEL[axis]}
                    value={dims[axis]}
                    onChange={(e) => setDims({ ...dims, [axis]: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                  />
                  <span className="sc-size-unit" aria-hidden>
                    {dims.unit}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <span className="sc-pdetails-hint">{hint}</span>
        </div>

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
