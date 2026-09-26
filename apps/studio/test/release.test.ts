import { describe, expect, it } from 'vitest';
import { readableDate, shortDate } from '../src/release.js';

describe('readableDate', () => {
  it('renders a record date the way the app writes dates', () => {
    expect(readableDate('2026-08-16')).toBe('16 August 2026');
  });

  it('drops the leading zero from the day', () => {
    expect(readableDate('2026-08-09')).toBe('9 August 2026');
  });

  it('does not slip a day west of Greenwich', () => {
    // `new Date('2026-01-01')` is midnight UTC, which is 31 December in every
    // timezone behind it. The regex parse is what stops that.
    expect(readableDate('2026-01-01')).toBe('1 January 2026');
    expect(readableDate('2026-12-31')).toBe('31 December 2026');
  });

  it('hands back anything it cannot parse rather than guessing', () => {
    expect(readableDate('not a date')).toBe('not a date');
    expect(readableDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('shortDate', () => {
  it('cuts every month to three letters with no full stop, September included', () => {
    expect(shortDate('2026-09-26')).toBe('26 Sep 2026');
    expect(shortDate('2026-05-01')).toBe('1 May 2026');
    expect(shortDate('2026-06-09')).toBe('9 Jun 2026');
    const months = Array.from({ length: 12 }, (_, i) => shortDate(`2026-${String(i + 1).padStart(2, '0')}-15`));
    for (const d of months) expect(d).toMatch(/^15 [A-Z][a-z]{2} 2026$/);
  });

  it('keeps the day on the calendar date and hands back what it cannot parse', () => {
    expect(shortDate('2026-01-01')).toBe('1 Jan 2026');
    expect(shortDate('2026-12-31')).toBe('31 Dec 2026');
    expect(shortDate('not a date')).toBe('not a date');
    expect(shortDate('2026-13-01')).toBe('2026-13-01');
  });
});
