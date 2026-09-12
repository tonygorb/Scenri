import { describe, expect, it } from 'vitest';
import { sayTime } from '../src/conversation/turnTime.js';

/**
 * When one turn was said, in the words a person would use. Arithmetic on two
 * numbers, pinned here rather than looked at.
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
