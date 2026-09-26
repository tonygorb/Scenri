import type { ReactNode } from 'react';
import { Star } from '@phosphor-icons/react';

/**
 * The keeper, drawn the way a card draws it before anything is kept.
 * Outline, quiet ink. Gold is the star that is on, and an empty tab has none.
 */
export const keepersMark = <Star size={21} weight="regular" />;

/**
 * The three states every library page can land in, sharing one component so
 * the tone and layout can't drift page to page: `error` (the catalog failed
 * to load — Retry), `cold` (the catalog is genuinely empty — a real
 * first-run moment, reuses the existing `.sc-canvas-empty` treatment), and
 * `zero` (nothing on the wall — either a filter that matched nothing or a tab
 * you have not filled yet). A title, when there is one, is the line; the
 * body is the one sentence under it; the action is the way back.
 */
export function LibraryEmpty({
  shape,
  title,
  body,
  action,
  mark,
  onRetry,
}: {
  shape: 'cold' | 'zero' | 'error';
  title?: ReactNode;
  body: ReactNode;
  action?: ReactNode;
  /** A mark for a tab that is empty on purpose. A search that missed has none. */
  mark?: ReactNode;
  onRetry?: () => void;
}) {
  if (shape === 'error') {
    return (
      <>
        <h1>{title ?? "Couldn't load this library"}</h1>
        <p className="sc-lookpage-lede">{body}</p>
        <div className="sc-lookpage-acts">
          <button type="button" className="sc-btn sc-btn-primary" onClick={onRetry}>
            Retry
          </button>
        </div>
      </>
    );
  }

  if (shape === 'cold') {
    return (
      <div className="sc-canvas-empty">
        {title && <h3>{title}</h3>}
        <p>{body}</p>
        {action && <div className="sc-lookpage-acts">{action}</div>}
      </div>
    );
  }

  return (
    <div className="sc-lib-zero">
      {mark && (
        <span className="sc-lib-zero-mark" aria-hidden>
          {mark}
        </span>
      )}
      {title && <h3>{title}</h3>}
      <p>{body}</p>
      {action}
    </div>
  );
}

/**
 * The zero-result state, said back to the user in their own words. "No scenes
 * match these filters" is true of every empty result and so tells you nothing;
 * quoting the term and naming the facet tells you which of the two to undo,
 * and the actions are exactly the undos that apply — never both when only one
 * is set. No creation CTA: it is already New in the top bar, and a
 * failed search is the wrong moment to sell.
 */
export function LibraryZero({
  noun,
  q,
  facet,
  onClearSearch,
  onClearAll,
}: {
  /** Plural noun for the catalog, e.g. "scenes". */
  noun: string;
  q: string;
  /** The active facet's label, e.g. "Portrait" — omitted when nothing is faceted. */
  facet?: string | null;
  onClearSearch: () => void;
  onClearAll: () => void;
}) {
  const term = q.trim();

  const body = term ? (
    <>
      No {noun} found for <em>“{term}”</em>
      {facet ? ` in ${facet}` : ''}
    </>
  ) : (
    <>
      No {noun} in {facet}
    </>
  );

  return (
    <LibraryEmpty
      shape="zero"
      body={body}
      action={
        <span className="sc-lib-zero-acts">
          {term && (
            <button type="button" className="sc-btn sc-btn-ghost" onClick={onClearSearch}>
              Clear search
            </button>
          )}
          {term && facet && (
            <button type="button" className="sc-btn sc-btn-ghost" onClick={onClearAll}>
              Clear all
            </button>
          )}
          {!term && (
            <button type="button" className="sc-btn sc-btn-ghost" onClick={onClearAll}>
              Clear filter
            </button>
          )}
        </span>
      }
    />
  );
}
