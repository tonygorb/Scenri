import { ArrowClockwise, X } from '@phosphor-icons/react';
import type { AssetBuild } from '../api.js';
import { describeFailure } from '../failure.js';
import { RunningTag } from './canvas/RunningTag.js';

/**
 * A presenter or scene while it is still being built.
 *
 * Sits in the same wall as the finished cards so the shape of the page does not
 * jump when it lands. While it runs it is only the wait: gold shimmer, elapsed
 * clock, a way to stop. No name, no stage copy — those used to sit under the
 * tile and make a generating card taller than the ones around it. The name
 * arrives with the finished card. A failure still says what died.
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
  /*
   * A failed build used to put the raw thrown string in the caption, where the
   * card has one line for it — so a build that died on a missing API key
   * reported "Codex request failed: HTTP 401 — {"error":{"me…". Read the same
   * way every other failure in the app is; the raw text stays on the title.
   */
  const failure = failed ? describeFailure(build.error) : null;

  return (
    // data-build is only the failed footer: a running tile has no caption, the
    // same as a Create shot still drawing. The name is in the stop control.
    <div
      className="sc-lookcard"
      data-variant="plain"
      data-size="grid"
      data-build={failed || undefined}
      data-building={!failed || undefined}
    >
      <div className="sc-lookcard-media">
        <span className="sc-lookcard-blank" />
        {!failed && (
          <>
            <span className="sc-rendering" />
            <RunningTag since={build.startedAt} />
          </>
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
      {failure ? (
        <span className="sc-lookcard-cap" title={failure.raw}>
          <b dir="auto">{build.name}</b>
          <span>{failure.title}</span>
        </span>
      ) : null}
    </div>
  );
}
