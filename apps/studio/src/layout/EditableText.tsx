import { useEffect, useState } from 'react';

/**
 * Text that is editable where it sits.
 *
 * Deliberately a real `<input>`/`<textarea>` at all times rather than a span
 * that swaps into a field: swapping loses the caret on the click that started
 * the edit, and it hides the control from assistive tech until it is too late
 * to matter. The chrome is what hides — CSS keeps the field looking like the
 * text it holds until it is hovered or focused.
 *
 * Commits on blur and on Enter; Escape puts it back. Nothing commits per
 * keystroke, because on this page every commit is a document write.
 */
export function EditableText({
  value,
  onCommit,
  placeholder,
  label,
  variant = 'body',
  multiline,
  maxLength,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  /** Accessible name — there is no visible label by design. */
  label: string;
  variant?: 'name' | 'lede' | 'body' | 'quote';
  multiline?: boolean;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  // Adopt changes from elsewhere (a re-scrape, a brand switch) but never mid-edit.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const shared = {
    className: 'sc-edit',
    'data-variant': variant,
    'data-empty': draft ? undefined : ('' as const),
    value: draft,
    placeholder,
    'aria-label': label,
    maxLength,
    dir: 'auto' as const,
    onFocus: () => setEditing(true),
    onBlur: () => {
      setEditing(false);
      const next = draft.trim();
      if (next !== value) onCommit(next);
      setDraft(next);
    },
  };

  if (multiline) {
    return (
      <textarea
        {...shared}
        rows={1}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
      />
    );
  }
  return (
    <input
      {...shared}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
