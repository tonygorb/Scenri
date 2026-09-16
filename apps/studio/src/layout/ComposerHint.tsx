import { X } from '@phosphor-icons/react';
import { useId } from 'react';
import { Tip } from './Tip.js';

/**
 * One first-use sentence as a row of the composer's notes tray (DESIGN.md,
 * "Composer hints"). It only says; the brief it sits on is what the person
 * acts on, and closing it is the same as having learned it.
 *
 * The words are hidden from assistive tech here because the brief line already
 * carries them as its description, read on the focus that made this appear;
 * the close is still reachable, and says what it closes.
 */
export function ComposerHint({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const id = useId();
  return (
    <div className="sc-banner" data-tone="hint">
      <span id={id} className="sc-banner-txt" aria-hidden="true">
        {text}
      </span>
      <Tip label="Dismiss hint">
        <button
          type="button"
          className="sc-icon-btn sc-banner-x"
          aria-label="Dismiss hint"
          aria-describedby={id}
          onClick={onDismiss}
        >
          <X size={13} />
        </button>
      </Tip>
    </div>
  );
}
