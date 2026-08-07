import type { ReactNode } from 'react';

/**
 * The one sticky row every library page shares — filter, search, and
 * primary action, nothing else. No visible page title or description: the
 * nav bar already names the page (and shows it active), so repeating it
 * here was a second, redundant header rather than useful copy. `title` is
 * kept as a visually-hidden `<h1>` only — a real page needs a heading for
 * assistive tech, it just doesn't need one taking up a row.
 */
export function LibraryToolbar({
  title,
  filters,
  active,
  summary,
  onClear,
  search,
  action,
}: {
  title: string;
  filters?: ReactNode;
  active?: boolean;
  summary?: ReactNode;
  onClear?: () => void;
  search?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="sc-filterbar">
      <h1 className="sc-vh">{title}</h1>

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
        {action}
      </div>
    </div>
  );
}
