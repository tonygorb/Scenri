import {
  type ClipboardEvent,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  forwardRef,
  type ReactNode,
  useEffect,
} from 'react';
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
  tone,
}: {
  open?: boolean;
  className?: string;
  /** `guide`: a first-use surface, held behind the guide's darker, softened curtain. */
  tone?: 'guide';
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
  /**
   * Say so, once, when a dialog takes the screen.
   *
   * Transient surfaces - the notifications panel above all - have no way to
   * know a modal has opened over them, so the bell stayed open underneath the
   * import dialog with two floating surfaces fighting for the same corner.
   * Announced from the shared shell rather than from any one dialog, so every
   * dialog gets the behaviour and no caller has to remember it.
   */
  useEffect(() => {
    if (open) window.dispatchEvent(new CustomEvent('scenri:modal-open'));
  }, [open]);
  const openFocus = onOpenAutoFocus ?? focusSelfOnOpen;
  // Default: let Radix restore focus to whatever opened the sheet. The old
  // default suppressed that, so closing any sheet built on this shell dropped
  // keyboard focus to <body>. Callers that manage a caret of their own (the
  // composer sheets) still pass an explicit handler and are untouched.
  const closeFocus = onCloseAutoFocus;

  return (
    <Primitive.Root open={open} onOpenChange={(o) => !o && onDismiss()}>
      <Primitive.Portal>
        <Primitive.Overlay className="sc-newdlg-scrim" data-tone={tone} />
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

/** The ref and any props pass through to the button, so a `Tip` can wrap it. */
export const SheetClose = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof Primitive.Close>>(
  function SheetClose({ children, ...rest }, ref) {
    return (
      <Primitive.Close asChild ref={ref} {...rest}>
        {children}
      </Primitive.Close>
    );
  },
);

/**
 * The sentence a dialog is described by. `asChild` lends that role to an
 * element of the caller's, so a heading can describe the dialog it heads
 * (What's New: the update's own headline) without a second copy of it.
 */
export function SheetDescription({
  className,
  asChild,
  children,
}: {
  className?: string;
  asChild?: boolean;
  children: ReactNode;
}) {
  return (
    <Primitive.Description className={className} asChild={asChild}>
      {children}
    </Primitive.Description>
  );
}
