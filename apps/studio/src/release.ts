/**
 * `yyyy-mm-dd` as a local date, the one date format this app writes.
 *
 * Lives outside the dialog because the studio's unit suite only sees `.ts` —
 * logic left inside a `.tsx` component is logic nothing can test.
 *
 * Parsed by hand on purpose: `new Date(iso)` reads a bare ISO date as UTC and
 * renders the day before anywhere west of Greenwich.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function readableDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])} ${month} ${m[1]}`;
}
