import { ArrowUp } from '@phosphor-icons/react';
import { Spinner } from '@radix-ui/themes';
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';
import { thumbUrl } from '../../api.js';
import type { ComposerState } from './presenterStudioRules.js';

/**
 * The one place a person says what should change: a sentence and Refine. It
 * is an editing field, not a chat. Nothing answers back in words; the picture
 * on the stage does. The chip at the top of the card names the picture Refine
 * will redraw, and the line under the card says what that means, both before
 * anything is pressed, because the same sentence can change the person or one
 * picture. The card is the Figma composer: radius 22, the scope chip over the
 * sentence at 15px, a Refine pill that reads Working while a picture is drawn.
 */
export function RefineComposer({
  placeholder,
  describe,
  disabled,
  working,
  error,
  onSend,
}: {
  placeholder: string;
  /** The chip and the line for the sentence as it stands, plus the chip's picture. */
  describe: (text: string) => ComposerState & { hash?: string };
  disabled?: boolean;
  /** A picture is being drawn: the pill says so. */
  working?: boolean;
  /** Why the last sentence went nowhere. */
  error?: string | null;
  /** True when the sentence was taken; the field clears. */
  onSend: (text: string) => boolean;
}) {
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const state = describe(text);

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
  const send = () => {
    if (off || !text.trim()) return;
    if (onSend(text)) setText('');
  };
  const line = error ? { text: error, tone: 'alert' as const } : { text: state.hint, tone: state.tone };
  return (
    <div className="sc-pstudio-composer">
      <div className="sc-pstudio-composer-card">
        {state.chip && (
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
          maxLength={240}
          aria-label="What should change"
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
        <div className="sc-pstudio-composer-row">
          <button
            type="button"
            className="sc-pstudio-send"
            aria-disabled={off || !text.trim() || undefined}
            aria-busy={working || undefined}
            onClick={send}
          >
            {working ? <Spinner size="1" /> : <ArrowUp size={17} weight="bold" />}
            {working ? 'Working' : 'Refine'}
          </button>
        </div>
      </div>
      <small
        className="sc-pstudio-composer-hint"
        role={line.tone === 'alert' ? 'alert' : undefined}
        data-tone={line.tone}
      >
        {line.text}
      </small>
    </div>
  );
}
