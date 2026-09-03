import { Spinner } from '@radix-ui/themes';
import { ArrowClockwise, X } from '@phosphor-icons/react';
import { type AssetBuild, thumbUrl } from '../api.js';
import { describeFailure } from '../failure.js';

/**
 * A presenter or scene while it is still being built.
 *
 * Sits in the same wall as the finished cards so the shape of the page does not
 * jump when it lands. It shows real progress rather than a spinner alone: a
 * build runs for minutes, and "3 of 4" is the difference between waiting and
 * wondering whether anything is happening.
 *
 * Only two states ever reach here: running and failed. A cancelled build is one
 * you stopped yourself, and a card reporting on that is furniture — the pages
 * filter it out before it gets this far.
 */
export function AssetBuildCard({
  build,
  onCancel,
  onRetry,
  onDismiss,
}: {
  build: AssetBuild;
  onCancel?: (id: string) => void;
  onRetry?: (build: AssetBuild) => void;
  /** Forget a build that failed. Without it the card sits there for another twelve. */
  onDismiss?: (id: string) => void;
}) {
  const failed = build.stage === 'failed';
  const pct = build.steps > 0 ? Math.round((build.step / build.steps) * 100) : 0;
  /*
   * A failed build used to put the raw thrown string in the caption, where the
   * card has one line for it — so a build that died on a missing API key
   * reported "Codex request failed: HTTP 401 — {"error":{"me…". Read the same
   * way every other failure in the app is; the raw text stays on the title.
   */
  const failure = failed ? describeFailure(build.error) : null;
  const status = failure ? failure.title : (build.message ?? 'Starting');

  /*
   * What the build wants to tell you that is not its status: a view that could
   * not be drawn, or which further photo would buy consistency. Both travel all
   * the way from the analyzer and used to stop here, unread.
   */
  const notes = [...build.warnings, ...build.coverage];

  return (
    // data-build carries the always-visible caption; data-building is the
    // running half of that. A card whose whole job is to report progress
    // cannot hide its status behind a hover the way a finished card does.
    <div className="sc-lookcard" data-variant="plain" data-size="grid" data-build data-building={!failed || undefined}>
      <div className="sc-lookcard-media">
        {build.previewHash ? (
          <img src={thumbUrl(build.previewHash, 'tile')} alt="" />
        ) : (
          <span className="sc-lookcard-blank">{failed ? null : <Spinner />}</span>
        )}
        {!failed && (
          <span className="sc-buildbar" aria-hidden>
            <span style={{ width: `${Math.max(6, pct)}%` }} />
          </span>
        )}
        {!failed && onCancel && (
          <button
            type="button"
            className="sc-cardpuck"
            aria-label={`Stop building ${build.name}`}
            onClick={() => onCancel(build.id)}
          >
            <X size={13} />
          </button>
        )}
        {failed && onDismiss && (
          <button
            type="button"
            className="sc-cardpuck"
            aria-label={`Dismiss ${build.name}`}
            onClick={() => onDismiss(build.id)}
          >
            <X size={13} />
          </button>
        )}
        {failed && onRetry && (
          <button type="button" className="sc-lookcard-use" onClick={() => onRetry(build)}>
            <ArrowClockwise size={12} /> Try again
          </button>
        )}
      </div>
      <span className="sc-lookcard-cap" title={failure?.raw || status}>
        <b dir="auto">{build.name}</b>
        <span>{status}</span>
      </span>
      {notes.length > 0 && (
        <ul className="sc-buildnotes">
          {notes.slice(0, 2).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
