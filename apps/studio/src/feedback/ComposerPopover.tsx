import { PaperPlaneTilt } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToasts } from '../toasts.js';
import { toMarkdown } from './markdown.js';
import { send } from './sink.js';
import type { Report, TargetIdentity } from './types.js';

/**
 * The whole form: one textarea and a Send button.
 *
 * No category, no severity, no steps-to-reproduce. A tester who has to fill in
 * a form files one report and then stops; the classification is work the owner
 * can do later from context that was captured automatically anyway.
 *
 * The disclosure below it is not decoration. It is the only place a tester
 * sees everything that is about to leave their machine — including the
 * compiled prompt, which is their own copy — so it renders the real report,
 * not a summary of it.
 */

const ACK_KEY = 'scenri:feedback-ack';

interface Props {
  anchor: Element;
  target: TargetIdentity;
  makeReport: (comment: string, target: TargetIdentity) => Report;
  onClose: () => void;
}

/** Beside the thing you picked, flipped when it would leave the viewport. */
function place(anchor: Element, panel: HTMLElement | null): { left: number; top: number } {
  const r = anchor.getBoundingClientRect();
  const w = panel?.offsetWidth ?? 360;
  const h = panel?.offsetHeight ?? 220;
  const gap = 8;
  let left = r.left;
  let top = r.bottom + gap;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - gap);
  if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
  return { left, top };
}

export function ComposerPopover({ anchor, target, makeReport, onClose }: Props) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [acked, setAcked] = useState(() => localStorage.getItem(ACK_KEY) === '1');
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  const panelRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { push } = useToasts();

  useLayoutEffect(() => {
    setPos(place(anchor, panelRef.current));
  }, [anchor]);

  useEffect(() => {
    areaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const reposition = () => setPos(place(anchor, panelRef.current));
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    // capture, so it follows the anchor inside a scrolling panel too
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [anchor, onClose]);

  const preview = () => toMarkdown(makeReport(comment, target));

  const onSend = async () => {
    if (busy) return;
    setBusy(true);
    // The clipboard write needs transient user activation, so `send` must be
    // the first await after the click. Nothing may be awaited before it.
    const res = await send(makeReport(comment, target));
    setBusy(false);
    localStorage.setItem(ACK_KEY, '1');
    onClose();
    push(
      res.ok
        ? {
            kind: 'success',
            title: 'Report copied',
            detail: 'Paste it into the issue that just opened, and a screenshot if it helps.',
          }
        : {
            kind: 'error',
            title: 'Could not reach the clipboard',
            detail: res.reason ?? 'Copy the report from the issue form instead.',
          },
    );
  };

  return createPortal(
    <>
      {/* Click-away. Transparent, so the app stays readable behind it. */}
      <div className="sc-fb-scrim" data-fb-ui="" role="presentation" onPointerDown={onClose} />
      <div
        ref={panelRef}
        className="sc-fb-pop"
        data-fb-ui=""
        role="dialog"
        aria-modal="true"
        aria-label="Report a problem"
        style={{ left: pos.left, top: pos.top }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="sc-fb-head">
          <h2 className="sc-fb-title">{target.area ?? 'This element'}</h2>
          <p className="sc-fb-meta">{target.nodeId ? 'Generated shot' : 'Interface'}</p>
        </header>

        {!acked && (
          <div className="sc-fb-notice">
            <p>
              Sends what you type, plus this page and this shot’s prompt, to scenri’s private feedback repo. Read all of
              it below before you send.
            </p>
            <button type="button" className="sc-btn sc-btn-ghost" onClick={() => setAcked(true)}>
              Got it
            </button>
          </div>
        )}

        <textarea
          ref={areaRef}
          value={comment}
          placeholder="What’s wrong or confusing?"
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void onSend();
          }}
        />

        <details className="sc-fb-disclose">
          <summary>Everything this sends</summary>
          <pre>{preview()}</pre>
        </details>

        <div className="sc-fb-row">
          <button type="button" className="sc-btn sc-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="sc-btn sc-btn-primary" disabled={busy} onClick={() => void onSend()}>
            <PaperPlaneTilt size={14} />
            {busy ? 'Copying…' : 'Send'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
