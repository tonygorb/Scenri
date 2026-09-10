/**
 * When things were said, in the words a person would use.
 *
 * A clock time on every turn is noise: a conversation had in one sitting wears
 * the same four digits twenty times over and answers a question nobody asked.
 * What a reader actually wants to know is two things, and they are different
 * questions with different answers:
 *
 * 1. "Where did this pause?" A run of turns is one moment. A gap between two of
 *    them is the only place a time carries information, so that is where the
 *    conversation says one, in the flow, for everyone to read at a glance.
 * 2. "When exactly was this one?" Asked of a single turn, rarely, by hovering
 *    it. Then the answer is relative while relative is what a person means
 *    ("just now", "12 min ago") and a clock time once it stops being.
 *
 * Both are pure functions of two numbers, so both are tested rather than
 * eyeballed, and neither knows anything about a presenter.
 */

/** A pause long enough to be a second sitting rather than a beat. */
export const GAP_MS = 5 * 60_000;

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

/**
 * The line between two runs, or null when the conversation simply carried on.
 *
 * `prev` is when the turn before this one was said, or undefined for the first
 * turn of all, which always gets one: a conversation opens by saying when it
 * began. Otherwise a mark appears only where there was a real pause, so the
 * marks in a transcript are exactly its sittings.
 */
export function whenMark(at: number, prev: number | undefined, now: number = Date.now()): string | null {
  if (prev !== undefined && at - prev < GAP_MS) return null;
  const d = new Date(at);
  const back = daysBack(d, new Date(now));
  if (back === 0) return `Today ${clock(d)}`;
  if (back === 1) return `Yesterday ${clock(d)}`;
  return `${day(d)} ${clock(d)}`;
}

/** The whole truth, for the title a cursor rests on and for screen readers. */
export const fullTime = (at: number): string =>
  new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
