/**
 * When things were said, in the words a person would use.
 *
 * A clock time standing on every turn is noise: a conversation had in one
 * sitting wears the same four digits twenty times over and answers a question
 * nobody asked. So it is there for the asking and not otherwise, and it answers
 * in the words the question was asked in: relative while relative is what a
 * person means ("just now", "12 min ago"), a clock time once it stops being.
 *
 * It is a pure function of two numbers, so it is tested rather than eyeballed,
 * and it knows nothing about a presenter.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const clock = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (d: Date) => d.toLocaleDateString([], { day: 'numeric', month: 'short' });

/** Midnights apart: 0 today, 1 yesterday, and so on. Never a count of hours. */
function daysBack(at: Date, now: Date): number {
  const a = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * One turn's time, as an answer to "when was this?".
 *
 * Relative for the hour it stays relative in a person's head, then the clock,
 * then the day and the clock. A time in the future (a clock nudged backwards,
 * a machine waking from sleep) reads as now rather than as a negative number.
 */
export function sayTime(at: number, now: number = Date.now()): string {
  const since = Math.max(0, now - at);
  if (since < 45_000) return 'just now';
  if (since < HOUR) {
    const mins = Math.max(1, Math.round(since / MINUTE));
    return `${mins} min ago`;
  }
  const d = new Date(at);
  const back = daysBack(d, new Date(now));
  if (back === 0) return clock(d);
  if (back === 1) return `Yesterday ${clock(d)}`;
  return `${day(d)} ${clock(d)}`;
}

/** The whole truth, for the title a cursor rests on and for screen readers. */
export const fullTime = (at: number): string =>
  new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
