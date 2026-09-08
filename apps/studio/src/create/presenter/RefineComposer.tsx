import { type KeyboardEvent, useState } from 'react';

/**
 * The one place a person says what should change: a sentence and Send. It is
 * an editing field, not a chat. Nothing answers back in words; the picture
 * on the stage does. The hint under it says what Send will do, before it is
 * pressed, because the same sentence can change the person or one picture.
 */
export function RefineComposer({
  placeholder,
  hint,
  disabled,
  error,
  onSend,
}: {
  placeholder: string;
  hint: string;
  disabled?: boolean;
  /** Why the last sentence went nowhere. */
  error?: string | null;
  /** True when the sentence was taken; the field clears. */
  onSend: (text: string) => boolean;
}) {
  const [text, setText] = useState('');
  const send = () => {
    if (disabled) return;
    if (onSend(text)) setText('');
  };
  return (
    <div className="sc-pstudio-composer">
      <div className="sc-pstudio-composer-row">
        <textarea
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
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          aria-disabled={disabled || !text.trim() || undefined}
          onClick={send}
        >
          Send
        </button>
      </div>
      {error ? (
        <small className="sc-pstudio-composer-hint" role="alert" data-tone="alert">
          {error}
        </small>
      ) : (
        <small className="sc-pstudio-composer-hint">{hint}</small>
      )}
    </div>
  );
}
