import type { ReactNode } from 'react';

/**
 * The three states every library page can land in, sharing one component so
 * the tone and layout can't drift page to page: `error` (the catalog failed
 * to load — Retry), `cold` (the catalog is genuinely empty — a real
 * first-run moment, reuses the existing `.sc-canvas-empty` treatment), and
 * `zero` (filters/search matched nothing — quiet text plus a way out).
 */
export function LibraryEmpty({
  shape,
  title,
  body,
  action,
  onRetry,
}: {
  shape: 'cold' | 'zero' | 'error';
  title?: ReactNode;
  body: ReactNode;
  action?: ReactNode;
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
      <p>{body}</p>
      {action}
    </div>
  );
}
