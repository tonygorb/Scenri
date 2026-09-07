import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { Slot, StudioView } from './studioRules.js';

/**
 * One decision per step. A candidate is approved, tried again, or adjusted
 * with a short sentence; an approved view revisited from the strip can be
 * redone; a failed step is retried. Never more than one primary.
 */
export function StudioActions({
  view,
  slot,
  isCurrent,
  busy,
  lastStep,
  onApprove,
  onAgain,
  onAdjust,
  onRedo,
  onBack,
}: {
  view: StudioView;
  slot: Slot;
  /** The view the build is on, as opposed to an approved one being looked at again. */
  isCurrent: boolean;
  busy: boolean;
  /** Approving this one finishes the set. */
  lastStep: boolean;
  onApprove: () => void;
  onAgain: () => void;
  onAdjust: (adjustment: string) => void;
  onRedo: () => void;
  onBack: () => void;
}) {
  const [adjusting, setAdjusting] = useState(false);
  const [adjustment, setAdjustment] = useState('');
  const adjustRef = useRef<HTMLInputElement>(null);
  // the field takes the keyboard when Adjust opens it, and only then
  useEffect(() => {
    if (adjusting) adjustRef.current?.focus();
  }, [adjusting]);
  const send = () => {
    const a = adjustment.trim();
    if (!a) return;
    setAdjusting(false);
    setAdjustment('');
    onAdjust(a);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setAdjusting(false);
    }
  };

  if (slot.status === 'generating') return null;

  if (!isCurrent && slot.status === 'approved') {
    return (
      <div className="sc-studio-actions">
        <button type="button" className="sc-btn sc-btn-ghost" disabled={busy} onClick={onRedo}>
          Redo this view
        </button>
        <button type="button" className="sc-btn sc-btn-ghost" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  if (slot.status === 'candidate') {
    return (
      <div className="sc-studio-actions">
        <button type="button" className="sc-btn sc-btn-primary" disabled={busy} onClick={onApprove}>
          {lastStep ? 'Approve & finish' : 'Approve & continue'}
        </button>
        <button type="button" className="sc-btn sc-btn-ghost" disabled={busy} onClick={onAgain}>
          {view === 'portrait' && !lastStep ? 'Try another' : 'Try again'}
        </button>
        {adjusting ? (
          <div className="sc-studio-adjust">
            <input
              ref={adjustRef}
              className="sc-in"
              type="text"
              aria-label="Adjust this view"
              placeholder="Slightly shorter hair"
              maxLength={240}
              value={adjustment}
              onChange={(e) => setAdjustment(e.target.value)}
              onKeyDown={onKey}
            />
            <button type="button" className="sc-btn sc-btn-ghost" disabled={busy || !adjustment.trim()} onClick={send}>
              Redraw
            </button>
          </div>
        ) : (
          <button type="button" className="sc-btn sc-btn-ghost" disabled={busy} onClick={() => setAdjusting(true)}>
            Adjust
          </button>
        )}
      </div>
    );
  }

  // empty after a failure, or stale: one button, the same verb either way
  return (
    <div className="sc-studio-actions">
      <button type="button" className="sc-btn sc-btn-primary" disabled={busy} onClick={onAgain}>
        {slot.error ? 'Retry' : 'Draw again'}
      </button>
    </div>
  );
}
