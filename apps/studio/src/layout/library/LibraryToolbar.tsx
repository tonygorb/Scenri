import type { ReactNode } from 'react';

/**
 * The one sticky row every catalog wall shares — tabs, search, density. The
 * page create lives on the top bar's New, not here. Home is the same chrome
 * with only tabs + density. No visible page title: the nav bar already names
 * the page. `title` is a visually-hidden `<h1>` only.
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
        {action ? <span className="sc-filterbar-cta">{action}</span> : null}
      </div>
    </div>
  );
}
