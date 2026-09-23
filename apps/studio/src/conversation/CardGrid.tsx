import type { ChoiceOption } from './question.js';

/**
 * A row of options answered by looking, laid out as a grid rather than a
 * strip: the whole set at once, wrapping rather than scrolling.
 *
 * The plate is the same plate `CardStrip` uses, at the same size, so a grid
 * row and a strip row read as one kind of thing. What differs is only whether
 * the set is compared side by side or swiped through one at a time, which is
 * a question of what is being chosen, not a different picture.
 */
export function CardGrid({
  options,
  picked,
  onPick,
}: {
  options: ChoiceOption[];
  /** The option that stands lit: the one just tapped, or the answer as it was. */
  picked: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="sc-convo-grid">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className="sc-convo-plate"
          aria-label={o.label}
          // the lit plate is state, not decoration: said, not only drawn
          aria-pressed={picked === o.id}
          data-on={picked === o.id || undefined}
          onClick={() => onPick(o.id)}
        >
          <span className="sc-convo-plate-in" data-card={o.card} />
          <span className="sc-convo-plate-lb">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
