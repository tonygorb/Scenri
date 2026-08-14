import type { ReactNode } from 'react';
import { Dialog, Spinner } from '@radix-ui/themes';
import { CaretLeft, X } from '@phosphor-icons/react';

/**
 * The one shape every "add something to this brand" flow wears.
 *
 * A product, a presenter and a scene are not the same object and their forms
 * do not pretend to be — this owns only the parts that should never differ:
 * where the title sits, where the error goes, what the primary looks like, and
 * the line under it saying what pressing it will actually do. The three bodies
 * are passed in as children and state their own fields.
 *
 * Built on Radix Themes' Dialog, like SettingsDialog, so the focus trap,
 * initial focus, return focus, scroll lock, Escape and backdrop all come for
 * free and behave identically to every other overlay in the app. Below 768px
 * the same markup becomes a bottom sheet, in CSS — no breakpoint in JS, so
 * there is never a second copy of this state.
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
  children,
}: {
  title: string;
  sub: string;
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
  children: ReactNode;
}) {
  return (
    <Dialog.Content
      className="sc-newdlg"
      maxWidth={width}
      aria-describedby={undefined}
      // Focus the surface, not the first field: on a phone this is a sheet, and
      // landing in a text input would open the keyboard over the form before
      // anyone had decided to type.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement | null)?.focus();
      }}
      // The host puts focus back where it came from. Radix would aim at the
      // element this Content remembers, which after a chooser-to-flow swap is
      // a row that no longer exists — so focus landed on the body.
      onCloseAutoFocus={(e) => e.preventDefault()}
    >
      <div className="sc-newdlg-head">
        {onBack && (
          <button type="button" className="sc-newdlg-back" onClick={onBack} aria-label="Back">
            <CaretLeft size={15} />
          </button>
        )}
        <Dialog.Title className="sc-newdlg-title">{title}</Dialog.Title>
        <Dialog.Close>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </Dialog.Close>
      </div>
      <p className="sc-newdlg-sub">{sub}</p>

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
    </Dialog.Content>
  );
}
