import { useState } from 'react';
import { Plus, X } from '@phosphor-icons/react';

/**
 * A list of short strings, entered one at a time.
 *
 * The studio had no such control: `.sc-chip` is a filter pill and the
 * composer's tokens are a contenteditable prose system, neither of which can
 * collect "warm daylight, natural textures" into an array. Three brand fields
 * need exactly that — imagery keywords, imagery avoid, and the standing rules.
 *
 * Entries commit on Enter, on comma, and on blur. Blur matters more than it
 * looks: without it a user types a last rule, clicks Save, and watches the
 * thing they just typed not be there.
 *
 * `suggestions` turns the blank page into a choice. A field that only accepts
 * typing assumes the user already knows what belongs in it, which is exactly
 * the assumption that made the sections around this one unanswerable. Offered,
 * never applied — and each one disappears once it is on the list.
 */
export function ChipsInput({
  value,
  onChange,
  placeholder,
  label,
  suggestions,
  max = 24,
  maxLength = 200,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Accessible name for the text field; the visible label sits outside. */
  label: string;
  /** Offered beneath the field, one tap to add. Already-added ones are filtered by the caller. */
  suggestions?: string[];
  max?: number;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState('');
  const full = value.length >= max;

  const commit = (raw: string) => {
    const next = raw.trim().slice(0, maxLength);
    setDraft('');
    if (!next || full) return;
    // Case-insensitive: "Neon" and "neon" are one instruction to a model, and
    // two chips that read the same are a bug report waiting to happen.
    if (value.some((v) => v.toLowerCase() === next.toLowerCase())) return;
    onChange([...value, next]);
  };

  return (
    <>
      <div className="sc-chips">
        {value.map((v, i) => (
          <span className="sc-chips-item" key={v}>
            <span dir="auto">{v}</span>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              aria-label={`Remove ${v}`}
            >
              <X size={10} weight="bold" />
            </button>
          </span>
        ))}
        <input
          className="sc-chips-in"
          value={draft}
          aria-label={label}
          /* The example only helps while the list is empty. Kept alongside a
           chip it repeated that chip's own words back as ghost text, which
           read as a duplicate entry. */
          placeholder={full ? undefined : value.length ? 'Add another…' : (placeholder ?? 'Add one…')}
          disabled={full}
          dir="auto"
          onChange={(e) => {
            const raw = e.target.value;
            // Typing or pasting a comma means "that was one entry, next".
            if (raw.includes(',')) {
              const parts = raw.split(',');
              for (const p of parts.slice(0, -1)) commit(p);
              setDraft(parts[parts.length - 1]);
              return;
            }
            setDraft(raw.slice(0, maxLength));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => commit(draft)}
        />
      </div>
      {!full && suggestions && suggestions.length > 0 && (
        <div className="sc-chips-sugg">
          {suggestions.map((s) => (
            <button type="button" key={s} className="sc-chip" onClick={() => commit(s)}>
              <Plus size={10} weight="bold" /> {s}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
