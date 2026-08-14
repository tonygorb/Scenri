import type { ReactNode } from 'react';

/**
 * The one sticky row every catalog wall shares — tabs, search, density, and
 * primary action. Home is the same chrome with only tabs + density. No
 * visible page title: the nav bar already names the page. `title` is a
 * visually-hidden `<h1>` only.
 */
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
  return (
    <div className="sc-filterbar">
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
        {/* Wide only. Under 1280px this row already has a scrolling facet rail
            and a search field to fit, and the top bar's + is the same action —
            two buttons for one job, one of which overflowed a 360px bar. */}
        {action ? <span className="sc-filterbar-cta">{action}</span> : null}
      </div>
    </div>
  );
}
