import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMediaQuery } from '../../useMediaQuery.js';

/**
 * The one sticky row every catalog wall shares — tabs, search, density, and
 * primary action. Home is the same chrome with only tabs + density. No
 * visible page title: the nav bar already names the page. `title` is a
 * visually-hidden `<h1>` only.
 */
/** Below this the primary action moves up into the top bar — see TopBar.tsx. */
const COMPACT = '(max-width: 1279px)';

export function LibraryToolbar({
  title,
  filters,
  active,
  summary,
  onClear,
  density,
  search,
  action,
}: {
  /** Omit on Home — it already has a visible `h1`. */
  title?: string;
  filters?: ReactNode;
  active?: boolean;
  summary?: ReactNode;
  onClear?: () => void;
  /** Shared grid density — Compact / Comfortable / Large. */
  density?: ReactNode;
  search?: ReactNode;
  action?: ReactNode;
}) {
  const compact = useMediaQuery(COMPACT);
  // The portal target is rendered by TopBar, which mounts before any route, but
  // the node only exists after that first paint — so resolve it in an effect.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById('sc-page-action')), []);
  const hoisted = compact && slot && action;

  return (
    <div className="sc-filterbar">
      {hoisted ? createPortal(action, slot) : null}
      {title ? <h1 className="sc-vh">{title}</h1> : null}

      {filters}

      <div className="sc-filterbar-actions">
        {active && (
          <span className="sc-lib-count">
            {summary}
            {onClear && (
              <button type="button" className="sc-lib-clear" onClick={onClear}>
                Clear
              </button>
            )}
          </span>
        )}
        {search}
        {density}
        {hoisted ? null : action}
      </div>
    </div>
  );
}
