import { describe, expect, it } from 'vitest';
import { GAP_MS, sayTime, whenMark } from '../src/conversation/turnTime.js';

/**
 * Two questions, two answers: where did the conversation pause, and when
 * exactly was this one turn. Both are arithmetic on two numbers, so both are
 * pinned here rather than looked at.
 */
const AT = new Date(2026, 8, 10, 14, 30, 0).getTime();
const mins = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;

describe('when one turn was said', () => {
  it('is relative while relative is what a person means', () => {
    expect(sayTime(AT, AT)).toBe('just now');
    expect(sayTime(AT, AT + 30_000)).toBe('just now');
    expect(sayTime(AT, AT + mins(1))).toBe('1 min ago');
    expect(sayTime(AT, AT + mins(12))).toBe('12 min ago');
    expect(sayTime(AT, AT + mins(59))).toBe('59 min ago');
  });

  it('becomes the clock once an hour has gone, and takes the day with it after midnight', () => {
    expect(sayTime(AT, AT + hours(2))).toMatch(/2:30|14:30/);
    const nextDay = new Date(2026, 8, 11, 9, 0, 0).getTime();
    expect(sayTime(AT, nextDay)).toMatch(/^Yesterday /);
    const later = new Date(2026, 8, 14, 9, 0, 0).getTime();
    expect(sayTime(AT, later)).toMatch(/Sep/);
  });

  it('never counts backwards when the clock moved under it', () => {
    expect(sayTime(AT, AT - hours(3))).toBe('just now');
  });
});

describe('where the conversation paused', () => {
  it('marks the first turn of all, and nothing that simply carried on', () => {
    expect(whenMark(AT, undefined, AT)).toBe(
      `Today ${new Date(AT).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    );
    expect(whenMark(AT + mins(1), AT, AT + mins(1))).toBeNull();
    expect(whenMark(AT + GAP_MS - 1, AT, AT)).toBeNull();
  });

  it('marks a real pause, and says the day when the pause crossed one', () => {
    expect(whenMark(AT + GAP_MS, AT, AT + GAP_MS)).toMatch(/^Today /);
    const nextMorning = new Date(2026, 8, 11, 9, 0, 0).getTime();
    expect(whenMark(nextMorning, AT, nextMorning)).toMatch(/^Today /);
    // read the next day again: what was "today" is yesterday, and says so
    const dayAfter = new Date(2026, 8, 12, 9, 0, 0).getTime();
    expect(whenMark(nextMorning, AT, dayAfter)).toMatch(/^Yesterday /);
  });
});
