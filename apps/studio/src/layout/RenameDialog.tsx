import { useEffect, useRef, useState } from 'react';
import { DialogSheet, SheetClose, SheetTitle } from './DialogSheet.js';

/**
 * The name, changed from the card menu.
 *
 * One field and one write, the same write the record's own page already
 * makes. The field grows with the name, because a product title is allowed
 * to run long and a single line would hide the words being edited.
 */
export function RenameDialog({
  title,
  name,
  maxLength,
  busy,
  error,
  onConfirm,
  onDismiss,
}: {
  title: string;
  name: string;
  /** The length the server will keep. A scene and a presenter stop at 60. */
  maxLength: number;
  busy?: boolean;
  error?: string | null;
  onConfirm: (name: string) => void;
  onDismiss: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const field = useRef<HTMLTextAreaElement>(null);
  const acted = useRef(false);
  const trimmed = draft.trim();
  const ready = trimmed.length > 0;

  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    acted.current = false;
    grow(field.current);
  }, [name]);
  useEffect(() => {
    if (!busy) acted.current = false;
  }, [busy]);

  const submit = () => {
    if (!ready || busy || acted.current) return;
    if (trimmed === name.trim()) return onDismiss();
    acted.current = true;
    onConfirm(trimmed);
  };

  return (
    <DialogSheet
      className="sc-newdlg sc-pdetails"
      maxWidth="min(420px, 94vw)"
      onDismiss={onDismiss}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        const el = field.current;
        if (!el) return;
        el.focus();
        el.select();
        grow(el);
      }}
    >
      <div className="sc-newdlg-head">
        <SheetTitle className="sc-newdlg-title">{title}</SheetTitle>
        <SheetClose asChild>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <span aria-hidden>{'×'}</span>
          </button>
        </SheetClose>
      </div>

      <div className="sc-newdlg-body">
        <label className="sc-pdetails-row">
          <span className="sc-pdetails-lb">Name</span>
          <textarea
            ref={field}
            className="sc-pdetails-field"
            value={draft}
            dir="auto"
            rows={1}
            maxLength={maxLength}
            aria-label="Name"
            onChange={(e) => {
              setDraft(e.target.value);
              grow(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>
        {error && <p className="sc-assetform-err">{error}</p>}
      </div>

      <div className="sc-newdlg-foot">
        <button type="button" className="sc-btn sc-btn-ghost" onClick={onDismiss}>
          Cancel
        </button>
        <button
          type="button"
          className="sc-btn sc-btn-primary"
          disabled={!ready || busy}
          data-busy={busy || undefined}
          onClick={submit}
        >
          {busy ? 'Saving' : 'Save'}
        </button>
      </div>
    </DialogSheet>
  );
}
