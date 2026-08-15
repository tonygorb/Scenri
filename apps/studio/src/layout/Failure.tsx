import type { ReactNode } from 'react';
import { ArrowCounterClockwise, Info, WarningCircle } from '@phosphor-icons/react';
import type { Failure } from '../failure.js';
import { useOpenSettings, useOpenSetup } from '../app/dialogs.js';

/**
 * A failure is an empty state with a reason, so it is built out of the empty
 * state rather than out of a box of its own: a round tinted mark, a display
 * line, a quiet sentence, one action — the shape `.sc-setup-done` and
 * `.sc-canvas-empty` already use everywhere else in the app.
 *
 * It replaced four grammars: the feed tile's grid of identical grey pills, the
 * stage's block of Radix `Flex` and inline `var(--red-9)`, the build card's
 * caption, and a bare `Callout color="red"` in three more places. None of them
 * said what to do next, and the failure in front of us was a missing API key,
 * which is one click from fixed.
 *
 * The buttons are the app's own — `.sc-btn` on a screen, `.sc-s` on a tile —
 * rather than a fifth pill invented for errors. An error is not a special kind
 * of surface; it is an ordinary surface with bad news on it.
 */
export function FailureNote({
  failure,
  density,
  onRetry,
  dismiss,
}: {
  failure: Failure;
  /**
   * How much room there is, not how bad it is. `tile` is a card in the feed,
   * `stage` is the middle of the shot's own screen. A surface that already owns
   * a box — a dialog, a page — wants `FailureRow` below instead.
   */
  density: 'tile' | 'stage';
  /** Absent where re-running makes no sense; also suppressed on a failure that cannot succeed twice. */
  onRetry?: () => void;
  /** The way to put it away. Labelled by the caller, because Archive and Restore are not the same word. */
  dismiss?: { label: string; onClick: () => void };
}) {
  const openSettings = useOpenSettings();
  const openSetup = useOpenSetup();
  const { remedy } = failure;
  const tile = density === 'tile';

  const act = () => {
    if (!remedy) return;
    if (remedy.opens === 'setup') openSetup('codex-cli');
    else openSettings(remedy.opens);
  };

  /*
   * Try again is offered only where it could work. On a missing key the second
   * run fails for exactly the reason the first one did, and a button certain to
   * fail is the interface lying about what it can do — so the remedy stands
   * alone and carries the whole weight.
   */
  const retry = onRetry && failure.retryable;
  // One primary per surface: whatever actually fixes it if we know, else the retry.
  const btn = (primary: boolean) =>
    tile ? `sc-s${primary ? ' sc-s-primary' : ''}` : `sc-btn ${primary ? 'sc-btn-primary' : 'sc-btn-ghost'}`;

  /*
   * A tile is a record. The cause fits; the cure, the raw text and a second
   * button do not — a 240px card carrying five things is a dialog wearing a
   * tile, and the shot's own screen carrying all five is one press away.
   */
  const showFix = !tile && !!failure.fix;
  const showRaw = !tile && !!failure.raw;

  return (
    <div
      className="sc-fail"
      data-density={density}
      data-kind={failure.kind}
      // The server writes one of these itself and it runs to three sentences.
      // Set at display size that is a headline which has stopped being one.
      data-long={failure.title.length > 90 || undefined}
      role="alert"
    >
      <span className="sc-fail-ic" aria-hidden>
        <WarningCircle size={tile ? 15 : 21} weight="fill" />
      </span>

      <div className="sc-fail-txt">
        <b>{failure.title}</b>
        {/* Wraps rather than ellipsing. This is the half that says what to do,
            and the tile used to clip the whole message mid-word at 200px — so
            the reason a shot failed was unreadable on the tile reporting it. */}
        {showFix && <small>{failure.fix}</small>}
      </div>

      {(remedy || retry || dismiss) && (
        <div className="sc-fail-acts">
          {remedy && (
            <button type="button" className={btn(true)} onClick={act}>
              {remedy.label}
            </button>
          )}
          {retry && (
            <button type="button" className={btn(!remedy)} onClick={onRetry}>
              <ArrowCounterClockwise size={tile ? 12 : 14} /> Try again
            </button>
          )}
          {/* Bare text, not a third pill. Putting it away is the one thing here
              not trying to rescue the shot, and as a matching pill it competed
              with Try again for the same press. */}
          {dismiss && (
            <button type="button" className="sc-fail-alt" onClick={dismiss.onClick}>
              {dismiss.label}
            </button>
          )}
        </div>
      )}

      {/* The engine's own words, verbatim and out of the way. */}
      {showRaw && (
        <details className="sc-fail-raw">
          <summary>Details</summary>
          <pre>{failure.raw}</pre>
        </details>
      )}
    </div>
  );
}

/**
 * The same note as a line rather than a centred state — a dialog, a page, a
 * route that could not load.
 *
 * The inside is the composer's own notice grammar, which has carried a full
 * `data-tone="error"` treatment since it was written and had no caller until
 * now. The box around it is this component's, not `.sc-notes`: that one is
 * bottomless and top-rounded because it docks onto the prompt card beneath it,
 * and standing alone it reads as a card someone forgot to finish.
 */
export function FailureRow({
  failure,
  action,
  tone = 'error',
}: {
  failure: Failure;
  action?: ReactNode;
  /**
   * `note` is for the outcomes that are not alarms — an import that finished
   * with gaps did not fail, and painting it red says it did. Same box, no red,
   * because the alternative was leaving it as the one raw Radix callout beside
   * a designed one.
   */
  tone?: 'error' | 'note';
}) {
  return (
    <div className="sc-failrow" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="sc-banner" data-tone={tone === 'error' ? 'error' : undefined}>
        <span className="sc-banner-ic">
          {tone === 'error' ? <WarningCircle size={16} weight="fill" /> : <Info size={16} weight="fill" />}
        </span>
        <span className="sc-banner-txt">
          <b>{failure.title}</b>
          {failure.fix && <small>{failure.fix}</small>}
        </span>
        {action}
      </div>
    </div>
  );
}
