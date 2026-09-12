import { CaretDown, Check, Plus } from '@phosphor-icons/react';
import { DropdownMenu } from '@radix-ui/themes';
import { useEffect, useRef, useState } from 'react';

/**
 * What a presenter is cast for, as one line.
 *
 * A wall of category chips in a creation form is a taxonomy chore standing
 * between a person and their face: eleven toggles, three rows of the rail,
 * and every one of them a decision nobody has the information to make yet.
 * The engine already answers this question, from the photographs or from the
 * portrait it drew, and what the user picks here only overrides that answer.
 *
 * So it is a field that reads like a field, and a menu that behaves like a
 * menu: at rest one line naming what is chosen; open, the brand's own
 * categories with a mark against the ones that are on, a box at the top that
 * narrows the list as you type, and one row that takes a word the brand has
 * never used. The list is an overlay, so nothing under it moves, and
 * choosing does not close it, because choosing two is the common case.
 */
export function CategoryMenu({
  value,
  categories,
  onChange,
  placeholder = 'Whatever they suit',
}: {
  value: string[];
  /** The brand's own categories, offered first. */
  categories: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);

  const known = [...categories, ...value.filter((v) => !categories.some((c) => same(c, v)))];
  const q = query.trim();
  const shown = q ? known.filter((c) => c.toLowerCase().includes(q.toLowerCase())) : known;
  const isNew = q.length > 0 && !known.some((c) => same(c, q));

  const toggle = (c: string) =>
    onChange(value.some((v) => same(v, c)) ? value.filter((v) => !same(v, c)) : [...value, c]);
  const add = () => {
    if (!isNew) return;
    onChange([...value, q.slice(0, 30)]);
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
        <button type="button" className="sc-pstudio-picker" aria-label="Categories">
          <span className="sc-pstudio-picker-lb" data-empty={value.length === 0 || undefined}>
            {value.length ? value.join(', ') : placeholder}
          </span>
          <CaretDown size={13} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" sideOffset={6} className="sc-menu sc-pstudio-menu">
        <input
          ref={field}
          className="sc-pstudio-menu-find"
          type="text"
          value={query}
          maxLength={30}
          placeholder="Find or add"
          aria-label="Find or add a category"
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
        <div className="sc-pstudio-menu-list">
          {shown.map((c) => {
            const on = value.some((v) => same(v, c));
            return (
              <DropdownMenu.Item
                key={c}
                className="sc-menu-item"
                data-on={on || undefined}
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
          {!shown.length && !isNew && <p className="sc-pstudio-menu-none">Nothing by that name.</p>}
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
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
