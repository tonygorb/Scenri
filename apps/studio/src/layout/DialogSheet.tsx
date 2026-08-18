import type { ClipboardEvent, CSSProperties, ReactNode } from 'react';
import * as Primitive from '@radix-ui/react-dialog';
import { focusSelfOnOpen } from '../app/dialogs.js';
import { useSheetDrag } from '../useSheetDrag.js';

/**
 * Create and What's new: one portal, overlay and panel as siblings.
 *
 * Themes Dialog.Content nests the card inside an animated overlay scroll
 * stack. `position: fixed` on that card is fixed to the overlay, not the
 * viewport — iOS Chrome paints it at the top, then jumps it to the bottom
 * when the overlay transform clears. The composer sheets already avoid that.
 * This is that shell, and CSS (not a JS breakpoint) decides whether the
 * panel is a bottom sheet or a centred card, so the first paint is the last.
 */
export function DialogSheet({
  open = true,
  className,
  maxWidth,
  described,
  children,
  onDismiss,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onPaste,
}: {
  open?: boolean;
  className?: string;
  maxWidth?: string;
  /** Set when a SheetDescription is inside, so Radix can point at it. */
  described?: boolean;
  children: ReactNode;
  onDismiss: () => void;
  onOpenAutoFocus?: (e: Event) => void;
  onCloseAutoFocus?: (e: Event) => void;
  onPaste?: (e: ClipboardEvent<HTMLDivElement>) => void;
}) {
  const { sheet, grip } = useSheetDrag(onDismiss);
  const openFocus = onOpenAutoFocus ?? focusSelfOnOpen;
  const closeFocus = onCloseAutoFocus ?? ((e: Event) => e.preventDefault());

  return (
    <Primitive.Root open={open} onOpenChange={(o) => !o && onDismiss()}>
      <Primitive.Portal>
        <Primitive.Overlay className="sc-newdlg-scrim" />
        <Primitive.Content
          className="sc-newdlg-layer"
          {...(described ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={openFocus}
          onCloseAutoFocus={closeFocus}
          onPaste={onPaste}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onDismiss();
          }}
        >
          <div
            ref={sheet}
            className={['sc-newdlg', className].filter(Boolean).join(' ')}
            style={maxWidth ? ({ '--sc-newdlg-max': maxWidth } as CSSProperties) : undefined}
          >
            <div className="sc-shotsheet-grip" {...grip}>
              <span className="sc-shotsheet-bar" aria-hidden />
            </div>
            {children}
          </div>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

export function SheetTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <Primitive.Title className={className}>{children}</Primitive.Title>;
}

export function SheetClose({ children }: { children: ReactNode }) {
  return <Primitive.Close asChild>{children}</Primitive.Close>;
}

export function SheetDescription({ className, children }: { className?: string; children: ReactNode }) {
  return <Primitive.Description className={className}>{children}</Primitive.Description>;
}
