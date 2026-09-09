import { ArrowUp } from '@phosphor-icons/react';
import { Spinner } from '@radix-ui/themes';
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';
import { thumbUrl } from '../../api.js';
import { Tip } from '../../layout/Tip.js';
import type { ComposerState } from './presenterStudioRules.js';

/**
 * The bottom of the rail, for the whole life of the dialog.
 *
 * A person is described here and then corrected here: the same card, in the
 * same place, from the first sentence to the last. It is an editing field and
 * never a chat, so nothing answers back in words; the picture on the stage
 * does. While a person is being refined the chip at the top of the card names
 * the picture the pill will redraw, and the line underneath says what that
 * means before anything is pressed, because one sentence can change the
 * person or one view of them. The card is the Figma composer: radius 22, the
 * sentence at 15px, a pill that says what it will do and reads Working while
 * a picture is drawn.
 */
export function RefineComposer({
  placeholder,
  label,
  action = 'Refine',
  hint,
  describe,
  value,
  onValue,
  allowEmpty,
  disabled,
  why,
  working,
  error,
  onSend,
}: {
  placeholder: string;
  /** The accessible name of the field, which is what the field is for right now. */
  label: string;
  /** What the pill will do, in a word. */
  action?: string;
  /** The line under the card, when there is no chip to explain. */
  hint?: string | null;
  /** Refining: the chip and the line for the sentence as it stands, plus the chip's picture. */
  describe?: (text: string) => ComposerState & { hash?: string };
  /** Held outside when the sentence has to survive a tab switch or a Start over. */
  value?: string;
  onValue?: (next: string) => void;
  /** The pill works with nothing typed: a photographs draft needs no sentence. */
  allowEmpty?: boolean;
  disabled?: boolean;
  /** Why the pill is dimmed, said on it when the cursor asks; the line under the card says it too. */
  why?: string | null;
  /** A picture is being drawn: the pill says so. */
  working?: boolean;
  /** Why the last sentence went nowhere. */
  error?: string | null;
  /** True when the sentence was taken; an uncontrolled field then clears. */
  onSend: (text: string) => boolean;
}) {
  const [own, setOwn] = useState('');
  const text = value ?? own;
  const setText = (next: string) => (onValue ? onValue(next) : setOwn(next));
  const field = useRef<HTMLTextAreaElement>(null);
  const state = describe?.(text);

  // One line that grows with the sentence, up to the cap the stylesheet sets;
  // a scrollbar only past that, never behind a placeholder.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = Number.parseFloat(getComputedStyle(el).maxHeight) || Number.POSITIVE_INFINITY;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [text]);

  const off = disabled || working;
  const empty = !text.trim() && !allowEmpty;
  const send = () => {
    if (off || empty) return;
    if (onSend(text) && value === undefined) setOwn('');
  };
  const line = error ? { text: error, tone: 'alert' as const } : { text: state?.hint ?? hint ?? '', tone: state?.tone };
  // A dimmed pill answers the cursor: the reason, or that the sentence is missing.
  const reason = working ? null : disabled && why ? why : empty && !disabled ? 'Nothing typed yet.' : null;
  const pill = (
    <button
      type="button"
      className="sc-pstudio-send"
      aria-disabled={off || empty || undefined}
      aria-busy={working || undefined}
      onClick={send}
    >
      {working ? <Spinner size="1" /> : <ArrowUp size={17} weight="bold" />}
      {working ? 'Working' : action}
    </button>
  );
  return (
    <div className="sc-pstudio-composer">
      <div className="sc-pstudio-composer-card">
        {state?.chip && (
          <div className="sc-pstudio-scope-row">
            <span className="sc-pstudio-scope" data-view={state.chip.view}>
              {state.hash ? <img src={thumbUrl(state.hash, 'micro')} alt="" /> : null}
              {state.chip.label}
            </span>
          </div>
        )}
        <textarea
          ref={field}
          className="sc-in"
          rows={1}
          maxLength={400}
          aria-label={label}
          placeholder={placeholder}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            e.preventDefault();
            send();
          }}
        />
        <div className="sc-pstudio-composer-row">{reason ? <Tip label={reason}>{pill}</Tip> : pill}</div>
      </div>
      {line.text ? (
        <small
          className="sc-pstudio-composer-hint"
          role={line.tone === 'alert' ? 'alert' : undefined}
          data-tone={line.tone}
        >
          {line.text}
        </small>
      ) : null}
    </div>
  );
}
