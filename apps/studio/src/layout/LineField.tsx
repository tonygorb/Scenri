import { useEffect, useRef } from 'react';

/**
 * A line of a record, editable in place.
 *
 * A textarea rather than a field: the names and captions people write run
 * long ("Wide mechanical keyboard, tenkeyless, walnut"), the static heading
 * wraps to a measure, and a single-line input would cut the same words off
 * mid-word the moment they became editable. It grows to its content, so a
 * page never scrolls a heading sideways, and it carries no chrome until the
 * caret is in it: a record you own reads as a record, not as a form.
 *
 * The class decides which line it is, so the same control can serve a name
 * and, at another size, a caption under it.
 */
export function LineField({
  value,
  onChange,
  onBlur,
  label,
  placeholder,
  className = 'sc-lookpage-titleedit',
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  /** What a screen reader calls it. */
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => grow(ref.current), [value]);
  return (
    <textarea
      ref={ref}
      className={className}
      rows={1}
      dir="auto"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        grow(e.currentTarget);
        onChange(e.target.value);
      }}
      onBlur={onBlur}
      onKeyDown={(e) => {
        // Enter commits and stands down; a name is one line, never a paragraph.
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
