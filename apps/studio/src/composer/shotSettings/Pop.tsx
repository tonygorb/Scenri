import { useEffect, useRef, type ReactNode } from 'react';
import { Popover } from '@radix-ui/themes';
import { openOnGroup } from './settings.js';

/**
 * The one surface all three settings open into: same fill, border, radius,
 * shadow and distance from its own trigger. Only the contents differ, because
 * a shape, a count and a size are not the same question and answering them
 * with one component is how the count ended up as a four-item dropdown.
 *
 * Opening focuses the option that is already set, so the first arrow key moves
 * from there rather than from nowhere. Picking closes: there is one choice
 * here, and staying open after it is made would be waiting for nothing.
 */
export function Pop({
  aria,
  width,
  trigger,
  open,
  onOpenChange,
  children,
  onCloseAutoFocus,
}: {
  aria: string;
  width: string;
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  children: (close: () => void) => ReactNode;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const body = useRef<HTMLDivElement>(null);

  /**
   * A surface on its way out must not take a click.
   *
   * Radix keeps the content mounted until its exit animation ends, and its
   * positioning wrapper is sized to it, so for those frames both were still
   * live boxes over the composer and the next click landed on a picker that had
   * already gone. The content is handled in CSS; the wrapper is Radix's own
   * element, and the `:has()` rule that reached it was dropped without a word
   * by the CSS minifier, so it is set here where nothing can quietly discard it.
   */
  useEffect(() => {
    const wrap = body.current?.parentElement;
    if (wrap) wrap.style.pointerEvents = open ? '' : 'none';
  }, [open]);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger>
        <button type="button" className="sc-var" aria-label={aria}>
          {trigger}
        </button>
      </Popover.Trigger>
      <Popover.Content
        ref={body}
        className="sc-setpop"
        align="end"
        sideOffset={8}
        width={width}
        onOpenAutoFocus={openOnGroup}
        onCloseAutoFocus={onCloseAutoFocus}
        /* the row owns which of the three is open; a press on it is never an
           interaction "outside" as far as this surface is concerned */
        /* A press on the row is never "outside" as far as this surface is
           concerned.

           Each setting is its own Radix root, so the open one used to treat a
           press on a neighbouring trigger as an interaction outside itself and
           dismiss on the very gesture that was opening the neighbour. Two
           layers then raced over one click and the surface you asked for opened
           and shut in the same frame. Excluded here, the row alone decides
           which of the three is open, and the switch is one state change. */
        onInteractOutside={(e) => {
          if ((e.target as Element | null)?.closest('.sc-prompt-pills')) e.preventDefault();
        }}
      >
        {children(() => onOpenChange(false))}
      </Popover.Content>
    </Popover.Root>
  );
}
