import type { Swatch } from './question.js';
import { LookArt } from './LookArt.js';
import { Strip } from './Strip.js';

/** One plate and the gap after it: what a press of an arrow moves. */
const STEP = 106;

/**
 * A row of drawn options, each a plate with its figure and its word.
 *
 * The plate is the one the stage already uses for its views, so a drawn choice
 * reads as part of the same product rather than as a picture pasted into a
 * chat, and the row scrolls rather than wrapping because nine plates in a grid
 * are a wall of near-identical grey.
 */
export function LookStrip({
  options,
  cast,
  on,
  onPick,
}: {
  options: Swatch[];
  /** Which figure the sheet shows, when it draws more than one. */
  cast?: string;
  /** The option that stands lit: the one just tapped, or the answer as it was. */
  on: string | null;
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
          data-on={on === o.id || undefined}
          onClick={() => onPick(o.id)}
        >
          <span className="sc-convo-plate-in">{o.art && <LookArt art={o.art} cast={cast} />}</span>
          <span className="sc-convo-plate-lb">{o.label}</span>
        </button>
      ))}
    </Strip>
  );
}
