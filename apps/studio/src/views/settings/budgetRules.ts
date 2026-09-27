/**
 * A monthly cap as it was typed: a number of dollars, `null` for no cap, or
 * `undefined` when it is not an amount at all.
 *
 * The field wears its own "$", but a "$" typed anyway, spaces and thousands
 * commas ("1,000") are how people write money, not another number. Anything
 * else is refused rather than guessed at: "20,50" is twenty and a half in half
 * the world and two thousand and fifty in the other half.
 */
export function readCap(raw: string): number | null | undefined {
  // Only an empty field takes the cap off: a lone "$" left behind is not a
  // decision to spend without limit.
  if (raw.trim() === '') return null;
  const s = raw
    .trim()
    .replace(/^\$\s*|\s*\$$/g, '')
    .replace(/\s+/g, '');
  const plain = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s;
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(plain)) return undefined;
  return Number(plain);
}
