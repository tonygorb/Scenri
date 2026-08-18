import { useRef, type ReactNode } from 'react';
import { Check } from '@phosphor-icons/react';

/**
 * A rectangle at the true proportion, centred in a fixed optical column.
 *
 * The column is what makes four of them stack with their names aligned; the
 * box inside it is the actual shape, so it is read before the numbers are. An
 * icon of a crop tool would have been the same picture beside all four.
 */
export function RatioGlyph({ w, h, slot, box }: { w: number; h: number; slot: number; box: number }) {
  const scale = box / Math.max(w, h);
  return (
    <span className="sc-ratio-slot" style={{ width: slot, height: slot }} aria-hidden>
      <span className="sc-ratio" style={{ width: Math.round(w * scale), height: Math.round(h * scale) }} />
    </span>
  );
}

/**
 * The mark on the option that is currently set.
 *
 * A bare check, not the filled disc the picker uses over a photograph: on a
 * small dark surface a solid white circle is the loudest thing on screen, and
 * the row is already lifted out of the list. Always rendered and hidden when
 * it is not the answer, or the value column shifts by its width on the one row
 * that has it and the list stops being a column.
 */
export const Tick = () => (
  <span className="sc-setpop-tick" aria-hidden>
    <Check size={12} weight="bold" />
  </span>
);

/**
 * One choice out of a few, as a radio group rather than a menu.
 *
 * A menu is a list of things to do; each of these is a list of what a value
 * currently *is*, which is why the dropdowns these replace could not show a
 * selection without inventing one. Arrow keys move the choice itself, the way
 * a native radio group does, so what has focus is always what is set.
 */
export function Choices({
  label,
  value,
  ids,
  unavailable = [],
  onChange,
  className,
  children,
}: {
  label: string;
  value: string;
  ids: string[];
  unavailable?: string[];
  onChange: (id: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const open = ids.filter((id) => !unavailable.includes(id));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : e.key === 'Home'
            ? 'first'
            : e.key === 'End'
              ? 'last'
              : null;
    if (step === null || !open.length) return;
    e.preventDefault();
    const here = open.indexOf(value);
    const next =
      step === 'first'
        ? open[0]
        : step === 'last'
          ? open[open.length - 1]
          : step === 1
            ? open[here < 0 || here === open.length - 1 ? 0 : here + 1]
            : open[here <= 0 ? open.length - 1 : here - 1];
    onChange(next);
    // every option is already in the DOM, so the move lands before the repaint
    ref.current?.querySelector<HTMLButtonElement>(`[data-id="${next}"]`)?.focus();
  };

  return (
    /* The group takes the focus when the surface opens, not the set option:
       focusing the option itself matched :focus-visible and painted the app's
       2px ring on it, so every mouse-opened picker arrived shouting. The
       arrows are handled here, so they work from the group, and the first one
       moves focus onto a real option — which is when a keyboard user should
       see a ring, and a mouse user never does. */
    <div className={className} role="radiogroup" aria-label={label} ref={ref} tabIndex={-1} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

export function Choice({
  id,
  on,
  unavailable,
  label,
  onPick,
  className,
  children,
}: {
  id: string;
  on: boolean;
  unavailable?: boolean;
  label: string;
  onPick: () => void;
  className: string;
  children: ReactNode;
}) {
  return (
    /* A native radio cannot carry the shape swatch, the name and the ratio as
       one hit target, and its own dot would be a second selected-state beside
       the row's lift. */
    // biome-ignore lint/a11y/useSemanticElements: see above
    <button
      type="button"
      role="radio"
      data-id={id}
      className={className}
      aria-checked={on}
      aria-label={label}
      aria-disabled={unavailable || undefined}
      data-on={on || undefined}
      // the set option is the group's one tab stop; the arrows reach the rest
      tabIndex={on ? 0 : -1}
      onClick={() => {
        if (!unavailable) onPick();
      }}
    >
      {children}
    </button>
  );
}

/** The line under a list that says what the engine will not do with it. */
export const Foot = ({ children }: { children: ReactNode }) => <p className="sc-setpop-foot">{children}</p>;
