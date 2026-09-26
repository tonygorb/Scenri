/**
 * Refinements asked for on a stage showing a picture, by the new step, and
 * when the step was made. The stage then starts the step's swirl from the
 * picture it shows rather than from nothing. Only the press records one, so a
 * Try again, or a running step opened later, forms as it always does.
 */
const asked = new Map<string, number>();

/** How long a press stays the start of its step's look (performance ms). */
const FRESH_MS = 4000;

export function markRefine(id: string) {
  asked.set(id, performance.now());
}

/** When this running step was asked for on the stage, if just now. */
export function refinedJustNow(id: string): number | undefined {
  const at = asked.get(id);
  if (at !== undefined && performance.now() - at < FRESH_MS) return at;
  asked.delete(id);
  return undefined;
}
