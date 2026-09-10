import { ArrowUp, Plus, X } from '@phosphor-icons/react';
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ColorPicker } from '../layout/ColorPicker.js';
import { Tip } from '../layout/Tip.js';

/** What the card shows around the sentence: which picture the pill will touch, and what that means. */
export interface ComposerScope {
  chip: { label: string; thumb?: string } | null;
  hint: string;
  tone?: 'alert';
}

/**
 * A colour as an answer, in the chip the rest of the app already uses for one.
 *
 * The chip is the brief line's: a swatch, the colour's name, and an X to take
 * it off. What it opens is the app's colour picker and nothing else, because
 * the colours a step has names for are already a row of swatches in the
 * question above; this is where a colour it has no name for comes from.
 */
export interface ComposerColour {
  /** The colour so far, or null while the chip stands empty. */
  hex: string | null;
  /** What the chip reads: the colour's name, or the invitation to pick one. */
  label: string;
  /** Where a colour of one's own starts, before anything is chosen. */
  seed?: string;
  onPick: (hex: string) => void;
  onClear: () => void;
}

/**
 * The composer under a transcript: the sentence, the pill that sends it,
 * and the scope chip that says what the sentence is aimed at.
 *
 * One card, in one place, for the whole life of a conversation: a person
 * describes here, names here, and corrects here, and the pill's word follows
 * the question. The card is the Figma composer: radius 22, the sentence at
 * 15px, a 38px pill that reads Working while a picture is drawn. It is an
 * editing field, never a chat: nothing answers back in words, the picture
 * on the stage does.
 */
export function ConversationComposer({
  placeholder,
  label,
  action = 'Send',
  scope,
  hint,
  value,
  onValue,
  allowEmpty,
  disabled,
  why,
  quiet,
  working,
  error,
  focusKey,
  onStop,
  onAttach,
  colour,
  onSend,
}: {
  placeholder: string;
  /** The accessible name of the field: what it is for right now. */
  label: string;
  /** The pill's word: Send, Continue, Refine. */
  action?: string;
  /** The chip over the sentence and the line under the card, as the sentence stands. */
  scope?: ComposerScope | null;
  /** The line under the card when no scope explains. */
  hint?: string | null;
  value: string;
  onValue: (next: string) => void;
  allowEmpty?: boolean;
  disabled?: boolean;
  /** Why the pill is dimmed, on it when the cursor asks; the line under the card says it too. */
  why?: string | null;
  /** Nothing here can be answered right now: on a phone it stands aside rather than taking the room. */
  quiet?: boolean;
  working?: boolean;
  error?: string | null;
  /** Changes when the field should take the keyboard: a new text question arrived. */
  focusKey?: string;
  /** While it works: stop what is drawing. The pill says Stop and does that. */
  onStop?: () => void;
  /** An attach button beside the pill: photographs can come in here too. */
  onAttach?: () => void;
  /** The answer is a colour: the app's own chip carries it, over the field. */
  colour?: ComposerColour | null;
  /** True when the sentence was taken; the flow then clears `value`. */
  onSend: (text: string) => boolean;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [focusedOnce, setFocusedOnce] = useState<string | undefined>(undefined);

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = Number.parseFloat(getComputedStyle(el).maxHeight) || Number.POSITIVE_INFINITY;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value]);

  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!focusKey || focusKey === focusedOnce || disabled) return;
    setFocusedOnce(focusKey);
    const el = field.current;
    el?.focus({ preventScroll: true });
    // an answer reopened for a change arrives with its words selected and the card lit once
    if (el && el.value) {
      el.select();
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 700);
      return () => clearTimeout(t);
    }
  }, [focusKey, focusedOnce, disabled]);

  const off = disabled || working;
  // a colour already chosen is an answer, even with nothing typed beside it
  const empty = !value.trim() && !allowEmpty && !colour?.hex;
  const send = () => {
    if (off || empty) return;
    onSend(value);
  };
  const line = error ? { text: error, tone: 'alert' as const } : { text: scope?.hint ?? hint ?? '', tone: scope?.tone };
  const reason = working ? null : disabled && why ? why : empty && !disabled ? 'Nothing typed yet.' : null;
  const pill = (
    <button
      type="button"
      className="sc-convo-send"
      aria-disabled={(working ? !onStop : off || empty) || undefined}
      aria-busy={working || undefined}
      data-stop={(working && !!onStop) || undefined}
      onClick={working ? onStop : send}
    >
      <span className="sc-convo-send-ico">
        {working ? <span className="sc-convo-spin" aria-hidden="true" /> : <ArrowUp size={17} weight="bold" />}
      </span>
      {working ? (onStop ? 'Stop' : 'Working') : action}
    </button>
  );
  return (
    <div className="sc-convo-composer">
      <div className="sc-convo-card" data-quiet={quiet || undefined} data-flash={flash || undefined}>
        {scope?.chip && (
          <div className="sc-convo-scope-row">
            <span className="sc-convo-scope">
              {scope.chip.thumb ? <img src={scope.chip.thumb} alt="" /> : null}
              {scope.chip.label}
            </span>
          </div>
        )}
        <div className="sc-convo-field">
          {colour && (
            <span className="sc-token" data-kind="color" data-empty={colour.hex ? undefined : ''} dir="ltr">
              <ColorPicker
                className="sc-convo-chip"
                triggerStyle={{ background: 'none' }}
                value={colour.hex ?? colour.seed ?? '#808080'}
                commitMode="live"
                align="start"
                label={colour.hex ? `${colour.label}. Change the colour.` : 'Pick a colour'}
                onChange={colour.onPick}
              >
                <span className="sc-token-swatch" style={colour.hex ? { background: colour.hex } : undefined} />
                <span className="sc-token-label">{colour.label}</span>
              </ColorPicker>
              {colour.hex && (
                <button type="button" className="sc-convo-chip-x" aria-label="Remove colour" onClick={colour.onClear}>
                  <X size={11} weight="bold" />
                </button>
              )}
            </span>
          )}
          <textarea
            ref={field}
            className="sc-in"
            rows={1}
            maxLength={400}
            aria-label={label}
            // the chip already says what the answer is; the invitation to type
            // would only crowd it
            placeholder={colour?.hex && !value ? '' : placeholder}
            value={value}
            disabled={disabled}
            onChange={(e) => onValue(e.target.value)}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key !== 'Enter' || e.shiftKey) return;
              e.preventDefault();
              send();
            }}
          />
        </div>
        <div className="sc-convo-row">
          {onAttach && (
            <Tip label="Add photos">
              <button type="button" className="sc-convo-attach" aria-label="Add photos" onClick={onAttach}>
                <Plus size={16} weight="bold" />
              </button>
            </Tip>
          )}
          {reason ? <Tip label={reason}>{pill}</Tip> : pill}
        </div>
      </div>
      {line.text ? (
        <small className="sc-convo-line" role={line.tone === 'alert' ? 'alert' : undefined} data-tone={line.tone}>
          {line.text}
        </small>
      ) : null}
    </div>
  );
}
