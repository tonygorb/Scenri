import { Check, Plus } from '@phosphor-icons/react';
import { DropdownMenu } from '@radix-ui/themes';
import { useEffect, useRef, useState } from 'react';
import { ChipField } from './ChipField.js';

/**
 * A list of short words, chosen from a menu or typed into it.
 *
 * One control, two intentions. What describes a presenter and what they are
 * filed under are the same act — putting a few words on a record — and they
 * were built as two different controls, one a field you type into and one a
 * menu you open, which is what made the sheet they share look assembled.
 * Here the field is the same in both and only the words on offer differ.
 *
 * The field reads like a field: the chosen words as chips, and the whole of
 * it opens the menu, which is where one is taken off again. The menu is a box
 * that
 * narrows the list as you type, the words already known with a mark against
 * the ones that are on, and a row that takes a word nobody has used before.
 * Choosing does not close it, because choosing two is the common case.
 *
 * Anchored on the field and not on a caret: a popper is sized from its
 * trigger, and a caret-sized trigger gave a menu clipped to a caret-sized
 * strip.
 */
export function ChipPicker({
  value,
  onChange,
  options,
  label,
  placeholder = 'Any',
  findPlaceholder = 'Find or add',
  emptyNote = 'Nothing by that name.',
  max = 12,
  maxLength = 40,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** The words already known here, offered first. */
  options: string[];
  /** What the field is, for a screen reader. */
  label: string;
  placeholder?: string;
  findPlaceholder?: string;
  emptyNote?: string;
  max?: number;
  maxLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);

  const known = [...options, ...value.filter((v) => !options.some((c) => same(c, v)))];
  const q = query.trim();
  const shown = q ? known.filter((c) => c.toLowerCase().includes(q.toLowerCase())) : known;
  const full = value.length >= max;
  const isNew = q.length > 0 && !known.some((c) => same(c, q)) && !full;

  const toggle = (c: string) => {
    const on = value.some((v) => same(v, c));
    if (!on && full) return;
    onChange(on ? value.filter((v) => !same(v, c)) : [...value, c]);
  };
  const add = () => {
    if (!isNew) return;
    onChange([...value, q.slice(0, maxLength)]);
    setQuery('');
    field.current?.focus();
  };

  // The box is what the keyboard should land in, not the first row: the list
  // is short and typing is the fast path. The menu focuses its own content on
  // open, so this has to happen after that.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => field.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <DropdownMenu.Trigger>
        <ChipField items={value} placeholder={placeholder} label={label} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" sideOffset={6} className="sc-menu sc-chippick-menu">
        <input
          ref={field}
          className="sc-chippick-find"
          type="text"
          value={query}
          maxLength={maxLength}
          placeholder={findPlaceholder}
          aria-label={findPlaceholder}
          onChange={(e) => setQuery(e.target.value)}
          // the menu's own typeahead would eat every letter
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              if (isNew) add();
              else if (shown.length === 1) toggle(shown[0]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        <div className="sc-chippick-list">
          {shown.map((c) => {
            const on = value.some((v) => same(v, c));
            return (
              <DropdownMenu.Item
                key={c}
                className="sc-menu-item"
                data-on={on || undefined}
                data-off={!on && full ? '' : undefined}
                // choosing two is the common case, so the menu stays open
                onSelect={(e) => {
                  e.preventDefault();
                  toggle(c);
                }}
              >
                <span className="sc-menu-lb">{c}</span>
                {on && <Check size={14} className="sc-menu-check" aria-hidden="true" />}
              </DropdownMenu.Item>
            );
          })}
          {!shown.length && !isNew && <p className="sc-chippick-none">{emptyNote}</p>}
        </div>
        {isNew && (
          <>
            <div className="sc-menu-sep" />
            <DropdownMenu.Item
              className="sc-menu-item"
              onSelect={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <Plus size={16} className="sc-menu-ic" />
              <span className="sc-menu-lb">Add "{q}"</span>
            </DropdownMenu.Item>
          </>
        )}
        {full && <p className="sc-chippick-none">That is as many as this holds.</p>}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
