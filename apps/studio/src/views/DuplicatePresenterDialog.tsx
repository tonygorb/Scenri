import { useEffect, useRef, useState } from 'react';
import { DialogSheet, SheetClose, SheetTitle } from '../layout/DialogSheet.js';

/**
 * The one field a duplicate needs: what to call the new person.
 * Prefills a unique suggestion, selects it, and one confirm is one write.
 */
export function DuplicatePresenterDialog({
  suggested,
  busy,
  error,
  onConfirm,
  onDismiss,
}: {
  suggested: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (name: string) => void;
  onDismiss: () => void;
}) {
  const [name, setName] = useState(suggested);
  const field = useRef<HTMLInputElement>(null);
  const acted = useRef(false);
  const trimmed = name.trim();
  const ready = trimmed.length > 0;

  useEffect(() => {
    acted.current = false;
  }, [suggested]);
  useEffect(() => {
    if (!busy) acted.current = false;
  }, [busy]);

  const submit = () => {
    if (!ready || busy || acted.current) return;
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
      }}
    >
      <div className="sc-newdlg-head">
        <SheetTitle className="sc-newdlg-title">Duplicate presenter</SheetTitle>
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
            ref={field}
            className="sc-pdetails-field"
            value={name}
            dir="auto"
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
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
          {busy ? 'Duplicating' : 'Duplicate'}
        </button>
      </div>
    </DialogSheet>
  );
}
