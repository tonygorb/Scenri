import type { ReactElement } from 'react';
import { Tooltip } from '@radix-ui/themes';

/**
 * The one way a card or tile sits out: inert through aria-disabled on the
 * element itself (a disabled button takes no pointer events, and the reason
 * would never show), and the reason on hover in the app's own tooltip coat.
 * With no reason there is nothing to wrap.
 */
export function SitOutTooltip({ why, children }: { why: string | null | undefined; children: ReactElement }) {
  return why ? (
    <Tooltip content={why} className="sc-tip" maxWidth="220px">
      {children}
    </Tooltip>
  ) : (
    children
  );
}
