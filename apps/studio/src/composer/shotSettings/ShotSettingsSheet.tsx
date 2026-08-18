import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { SlidersHorizontal } from '@phosphor-icons/react';
import { useSheetDrag } from '../../useSheetDrag.js';
import { ShotSettingsFields } from './ShotSettingsFields.js';
import { openOnGroup, type ShotSettingsProps } from './settings.js';

/**
 * Aspect, variants and resolution for a phone. The row cannot hold six controls
 * at 390px, so below 768px these collapse into one chip and come back as a
 * sheet under the thumb.
 *
 * Named rows, each with every one of its answers on show. A popover per row
 * would have read tidier and cost two taps and a second floating surface for a
 * choice of four; here the whole state is legible at a glance and a change is
 * one tap. Nothing closes the sheet: the point of opening it is often to set
 * two things, and the scrim is always right there.
 *
 * The chip and the desktop controls render together and CSS picks one, so there
 * is no breakpoint in JS and no second copy of the state: both drive the same
 * prefs held by the Composer.
 */
export function ShotSettings(props: ShotSettingsProps) {
  const [open, setOpen] = useState(false);
  const { sheet, grip } = useSheetDrag(() => setOpen(false));

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="sc-var sc-shotset" aria-label="Shot settings" title="Shot settings">
          <SlidersHorizontal size={16} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="sc-shotsheet-scrim" />
        <Dialog.Content
          ref={sheet}
          className="sc-shotsheet"
          aria-describedby={undefined}
          onOpenAutoFocus={openOnGroup}
          /* Radix would otherwise pull focus to the chip, and the next
             keystroke meant for the brief would be lost */
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="sc-shotsheet-grip" {...grip}>
            <span className="sc-shotsheet-bar" aria-hidden />
            {/* the named rows below say what this is; the heading is for the
                screen reader that cannot see them yet */}
            <Dialog.Title className="sc-vh">Shot settings</Dialog.Title>
          </div>

          <ShotSettingsFields {...props} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
