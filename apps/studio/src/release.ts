import type { ReleaseEntry } from './api.js';

/**
 * Reading a release record, in the two ways the UI needs it.
 *
 * Lives outside the dialog because both of these are plain functions over
 * data, and the studio's unit suite only sees `.ts` — logic left inside a
 * `.tsx` component is logic nothing can test.
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

/**
 * `yyyy-mm-dd` as a local date, the one date format this app writes.
 *
 * Parsed by hand on purpose: `new Date(iso)` reads a bare ISO date as UTC and
 * renders the day before anywhere west of Greenwich.
 */
export function readableDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/**
 * One line describing a release, for the list of earlier ones.
 *
 * The headline when the release has one; otherwise the areas it touched, which
 * is a fact already in the record rather than a summary invented here. A
 * release with neither says nothing, and the caller renders nothing.
 */
export function summarise(entry: ReleaseEntry): string {
  if (entry.title) return entry.title;
  return entry.sections.map((s) => s.heading).join(', ');
}
