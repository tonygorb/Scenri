import { ArrowUp, Plus, X } from '@phosphor-icons/react';
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ColorPicker } from '../layout/ColorPicker.js';
import { Tip } from '../layout/Tip.js';
import { PHONE, useMediaQuery } from '../useMediaQuery.js';

/** What the card shows around the sentence: which picture the pill will touch, and what that means. */
export interface ComposerScope {
  chip: { label: string; thumb?: string } | null;
  hint: string;
  tone?: 'alert';
}

/**
 * A picture riding with the answer, in the chip the rest of the app uses for
 * one: the thumbnail, its word, and an X. It is in the line because that is
 * where the answer is being written, and it is there the moment the file is
 * chosen, whatever the upload is still doing.
 */
export interface ComposerRef {
  key: string;
  /** What to show now: the file itself while it travels, the stored picture after. */
  src: string;
  label: string;
  /** Still on its way: the chip says so rather than pretending. */
  busy?: boolean;
  onRemove: () => void;
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
  onAttachFiles,
  attachLabel,
  colour,
  refs,
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
  /** An attach button beside the pill: pressed, it is the flow's to answer. */
  onAttach?: () => void;
  /** Or the same button opens the file chooser and hands the pictures over. */
  onAttachFiles?: (files: File[]) => void;
  /** What that button is for, in a few words. */
  attachLabel?: string;
  /** The answer is a colour: the app's own chip carries it, over the field. */
  colour?: ComposerColour | null;
  /** Pictures riding with the answer, each as its own chip in the line. */
  refs?: ComposerRef[];
  /** True when the sentence was taken; the flow then clears `value`. */
  onSend: (text: string) => boolean;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
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
  // A phone answers a focus with its keyboard, and the keyboard takes half the
  // screen. Arriving at a question made of swatches with the keys already up,
  // over the swatches, is the keyboard answering a question nobody asked: a
  // finger opens it by tapping the field, the way every other app on a phone
  // behaves. A pointer has no such cost, so nothing changes there.
  const phone = useMediaQuery(PHONE);
  useEffect(() => {
    if (!focusKey || focusKey === focusedOnce || disabled) return;
    setFocusedOnce(focusKey);
    if (phone) return;
    const el = field.current;
    el?.focus({ preventScroll: true });
    // an answer reopened for a change arrives with its words selected and the card lit once
    if (el && el.value) {
      el.select();
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 700);
      return () => clearTimeout(t);
    }
  }, [focusKey, focusedOnce, disabled, phone]);

  const off = disabled || working;
  // a colour chosen, or a picture attached, is an answer even with nothing
  // typed beside it
  const ready = !!colour?.hex || !!refs?.some((r) => !r.busy);
  const empty = !value.trim() && !allowEmpty && !ready;
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
          {refs?.map((r) => (
            <span key={r.key} className="sc-token" data-kind="image" data-busy={r.busy || undefined} dir="ltr">
              <img src={r.src} alt="" />
              <span className="sc-token-label">{r.label}</span>
              <button type="button" className="sc-convo-chip-x" aria-label={`Remove ${r.label}`} onClick={r.onRemove}>
                <X size={11} weight="bold" />
              </button>
            </span>
          ))}
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
            // a colour chosen is the answer, so the invitation would crowd it;
            // a picture rides with words that are still wanted, so it stays
            // A field that cannot be typed into says why, in the field: the pill's
            // tooltip is the same words, and on a touch screen a tooltip is a
            // thing that never happens.
            placeholder={colour?.hex && !value ? '' : disabled && why ? why : placeholder}
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
          {(onAttach || onAttachFiles) && (
            <>
              {/* It stays where it is when it cannot be used, dimmed, saying why
                  on the cursor: the pill beside it does exactly the same, and a
                  control that vanishes teaches nobody where pictures go. */}
              <Tip label={off && why ? why : (attachLabel ?? 'Add photos')}>
                <button
                  type="button"
                  className="sc-convo-attach"
                  aria-label={attachLabel ?? 'Add photos'}
                  aria-disabled={off || undefined}
                  onClick={off ? undefined : onAttachFiles ? () => files.current?.click() : onAttach}
                >
                  <Plus size={16} weight="bold" />
                </button>
              </Tip>
              {onAttachFiles && (
                <input
                  ref={files}
                  type="file"
                  accept="image/*"
                  hidden
                  aria-label={attachLabel ?? 'Add a picture'}
                  onChange={(e) => {
                    const chosen = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
                    e.target.value = '';
                    if (chosen.length) onAttachFiles(chosen);
                  }}
                />
              )}
            </>
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
