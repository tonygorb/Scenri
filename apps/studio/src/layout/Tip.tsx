import type { ReactElement } from 'react';
import { Tooltip } from '@radix-ui/themes';

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
      {children}
    </Tooltip>
  );
}
