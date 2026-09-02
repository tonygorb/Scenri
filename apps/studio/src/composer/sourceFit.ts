/**
 * How many of a row of cards fit on one line beside a "+N" chip.
 *
 * Whole cards only, in order; the chip is reserved as soon as anything is
 * left over. The one refinement is for a leftover of exactly one: a "+1"
 * that hides a single card is as wide as the card it hides, so if the whole
 * row fits once the chip is not needed, the row is shown instead.
 */
export function fitCount(widths: number[], gap: number, moreWidth: number, available: number): number {
  const n = widths.length;
  const span = (k: number) => widths.slice(0, k).reduce((a, w) => a + w, 0) + Math.max(0, k - 1) * gap;
  if (span(n) <= available) return n;
  let k = 0;
  while (k < n && span(k + 1) + gap + moreWidth <= available) k++;
  return k;
}
