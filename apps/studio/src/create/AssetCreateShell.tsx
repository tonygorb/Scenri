import type { ReactNode } from 'react';
import { Spinner } from '@radix-ui/themes';
import { CaretLeft, X } from '@phosphor-icons/react';
import { useDialogParam } from '../app/AppShell.js';
import { DialogSheet, SheetClose, SheetTitle } from '../layout/DialogSheet.js';

/**
 * The one shape every "add something to this brand" flow wears.
 *
 * A product, a presenter and a scene are not the same object and their forms
 * do not pretend to be — this owns only the parts that should never differ:
 * where the title sits, where the error goes, what the primary looks like, and
 * the line under it saying what pressing it will actually do. The three bodies
 * are passed in as children and state their own fields.
 *
 * DialogSheet is a centred card above 768px and the same bottom sheet the
 * composer chips already use below — overlay and content as siblings, so
 * iOS never treats the sheet as fixed to an animating overlay.
 */
export function AssetCreateShell({
  title,
  sub,
  error,
  footnote,
  primaryLabel,
  ready,
  blocked,
  busy,
  width = '440px',
  onBack,
  onPrimary,
  onPasteFiles,
  children,
}: {
  title: string;
  /** Omitted on the three forms — the title and the material say enough. */
  sub?: string;
  error?: string | null;
  /** What is about to happen, said before it happens. Never empty. */
  footnote?: ReactNode;
  primaryLabel: string;
  ready: boolean;
  /** Why the primary is inert, for the people who need to be told. */
  blocked?: string;
  busy?: boolean;
  /** Only the measure changes between flows; everything else is fixed. */
  width?: string;
  /** Rendered only when there is a chooser behind this to go back to. */
  onBack?: () => void;
  onPrimary: () => void;
  /** Images on the clipboard become references, same as a drop. */
  onPasteFiles?: (files: File[]) => void;
  children: ReactNode;
}) {
  const { close } = useDialogParam('new');
  return (
    <DialogSheet
      maxWidth={width}
      onDismiss={close}
      onPaste={(e) => {
        if (!onPasteFiles) return;
        const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return;
        e.preventDefault();
        onPasteFiles(files);
      }}
    >
      <div className="sc-newdlg-head">
        {onBack && (
          <button type="button" className="sc-newdlg-back" onClick={onBack} aria-label="Back">
            <CaretLeft size={15} />
          </button>
        )}
        <SheetTitle className="sc-newdlg-title">{title}</SheetTitle>
        <SheetClose>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </SheetClose>
      </div>
      {sub && <p className="sc-newdlg-sub">{sub}</p>}

      <div className="sc-newdlg-body">{children}</div>

      <div className="sc-newdlg-foot">
        {error && (
          <p className="sc-newdlg-err" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="sc-btn sc-btn-primary sc-dlg-go"
          // aria-disabled, not the native attribute: a disabled button leaves
          // the tab order, taking the only explanation of why it is inert with it.
          aria-disabled={!ready || busy || undefined}
          title={blocked}
          onClick={() => {
            if (ready && !busy) onPrimary();
          }}
        >
          {busy ? <Spinner size="1" /> : null}
          {primaryLabel}
        </button>
        {footnote && <p className="sc-dlg-foot">{footnote}</p>}
      </div>
    </DialogSheet>
  );
}
