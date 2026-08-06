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
}: {
  label: string;
  title: string;
  body: string;
  busy: boolean;
  onConfirm: () => void;
  /** Matches a full-width sibling button stack (e.g. the Info tab's Export/Keep/Archive rows). */
  fullWidth?: boolean;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger>
        <button
          type="button"
          className="sc-btn sc-btn-ghost sc-btn-red"
          disabled={busy}
          style={fullWidth ? { width: '100%' } : undefined}
        >
          {label}
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description size="2">{body}</AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" onClick={onConfirm}>
              {label}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
