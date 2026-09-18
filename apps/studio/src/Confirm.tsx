import { useEffect, useRef } from 'react';
import { AlertDialog, Button, Flex } from '@radix-ui/themes';

/** A destructive action behind a real confirm, not a toast — for anything
 * that has no Undo. `label` doubles as both the trigger button's text and
 * the confirm action's own label, so the two always agree on what's about
 * to happen. */
export function Confirm({
  label,
  title,
  body,
  busy,
  onConfirm,
  fullWidth,
  open,
  onOpenChange,
  tone = 'red',
}: {
  label: string;
  title: string;
  body: string;
  busy: boolean;
  onConfirm: () => void;
  /** Matches a full-width sibling button stack (e.g. the Info tab's Export/Keep/Archive rows). */
  fullWidth?: boolean;
  /** Controlled, for a confirm opened from somewhere that unmounts on select (a menu item): no trigger is rendered. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The trigger's colour: red for a delete, quiet for an act that only throws work away. The confirm itself stays red. */
  tone?: 'red' | 'quiet';
}) {
  /**
   * One confirm is one act.
   *
   * The trigger is disabled while busy, but the action inside the dialog never
   * was, and `busy` is state that does not change inside a tick. A double
   * press on a delete sent two deletes, and on a Start over two discards. The
   * latch is per opening, so confirming, cancelling and confirming again works.
   */
  const acted = useRef(false);
  useEffect(() => {
    acted.current = false;
  }, [open]);
  const confirm = () => {
    if (acted.current) return;
    acted.current = true;
    onConfirm();
  };
  /**
   * Where the keyboard was when a confirm with no trigger opened.
   *
   * Radix hands focus back to the trigger on close, and a confirm opened by
   * state (Escape on a studio, a pencil) has none, so staying left the keyboard
   * on the page behind the dialog. It goes back where it came from instead.
   */
  const back = useRef<HTMLElement | null>(null);
  const controlled = open !== undefined;
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) acted.current = false;
        onOpenChange?.(next);
      }}
    >
      {open === undefined && (
        <AlertDialog.Trigger>
          <button
            type="button"
            className={tone === 'red' ? 'sc-btn sc-btn-ghost sc-btn-red' : 'sc-btn sc-btn-ghost'}
            disabled={busy}
            style={fullWidth ? { width: '100%' } : undefined}
          >
            {label}
          </button>
        </AlertDialog.Trigger>
      )}
      <AlertDialog.Content
        maxWidth="420px"
        onOpenAutoFocus={() => {
          if (controlled) back.current = document.activeElement as HTMLElement | null;
        }}
        onCloseAutoFocus={(e) => {
          if (!controlled || !back.current?.isConnected) return;
          e.preventDefault();
          back.current.focus();
        }}
      >
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description size="2">{body}</AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" onClick={confirm} disabled={busy}>
              {label}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
