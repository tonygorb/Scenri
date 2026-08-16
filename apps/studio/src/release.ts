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
 * The areas it touched, always — never the release's own headline, even when
 * it has one. The question this list answers is "did I miss anything", and
 * "Create, Library, Brand" answers it for every release, where a headline
 * answers it only for the releases someone thought to write one for. It is
 * also a fact already in the record rather than a summary invented here.
 *
 * The headline is not lost: it still leads the release itself, in full, when
 * that release is the one you are running.
 */
export function summarise(entry: ReleaseEntry): string {
  return entry.sections.map((s) => s.heading).join(', ');
}
