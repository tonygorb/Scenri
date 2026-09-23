import { cloneElement, type FocusEvent, type ReactElement } from 'react';
import { Tooltip } from '@radix-ui/themes';
import { inputModality } from '../inputModality.js';

/**
 * One short sentence for an icon-only control, on hover and on keyboard
 * focus, in the app's own coat (`.sc-tip`, the same one SitOutTooltip wears).
 * The control keeps its `aria-label`; this is the sighted reader's copy of
 * it, so the two say the same words. Never a native `title` beside it: that
 * is the same sentence a second time, in the browser's coat, on a slower
 * clock.
 *
 * `open` forces the card, for the moment after an action when the words
 * change ("Copied"): the tooltip becomes the feedback, so nothing else has
 * to appear. Left undefined, Radix owns the timing.
 */
export function Tip({ label, open, children }: { label: string; open?: boolean; children: ReactElement }) {
  return (
    <Tooltip content={label} className="sc-tip" maxWidth="220px" {...(open ? { open: true } : {})}>
      {keyboardOnlyFocus(children)}
    </Tooltip>
  );
}

/**
 * The same tip on a card's icon, on Create and on a catalog wall. Touch has
 * no hover, and a tap there is the action, so the control is returned bare.
 */
export function iconTip(label: string, control: ReactElement, touch: boolean): ReactElement {
  return touch ? control : <Tip label={label}>{control}</Tip>;
}

/**
 * Radix opens a tooltip on any focus, including the focus a menu or dialog
 * hands back to its trigger as it closes. After a click that is a tooltip
 * nobody asked for, so focus opens it only when the keyboard moved last. The
 * child's handler runs first and Radix skips its own once the event is marked.
 */
export function keyboardOnlyFocus(child: ReactElement): ReactElement {
  const own = (child.props as { onFocus?: (e: FocusEvent<HTMLElement>) => void }).onFocus;
  return cloneElement(child as ReactElement<{ onFocus?: (e: FocusEvent<HTMLElement>) => void }>, {
    onFocus: (e: FocusEvent<HTMLElement>) => {
      own?.(e);
      if (inputModality() === 'pointer') e.preventDefault();
    },
  });
}
