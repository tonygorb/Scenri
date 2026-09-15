import type { ChoiceOption } from './question.js';
import { Strip } from './Strip.js';

/**
 * A row of options answered by looking: each a plate with a photograph of the
 * thing itself and its word under it.
 *
 * The plate is the same plate the drawn rows use, at the same size and step,
 * so every row that scrolls in the conversation reads as one kind of thing.
 * The picture is the plate's own surface, named by the stylesheet that owns
 * every one of them: no bundler glob, no runtime fetch.
 */
/** One plate and the gap after it: what a press of an arrow moves. */
const STEP = 106;

export function CardStrip({
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
    <Strip step={STEP}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className="sc-convo-plate"
          aria-label={o.label}
          data-on={picked === o.id || undefined}
          onClick={() => onPick(o.id)}
        >
          <span className="sc-convo-plate-in" data-card={o.card} />
          <span className="sc-convo-plate-lb">{o.label}</span>
        </button>
      ))}
    </Strip>
  );
}
