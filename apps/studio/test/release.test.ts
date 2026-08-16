import { describe, expect, it } from 'vitest';
import { readableDate, summarise } from '../src/release.js';

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

describe('summarise', () => {
  const entry = (over: Partial<Parameters<typeof summarise>[0]>) => ({
    version: '1.0.0',
    date: '2026-08-16',
    sections: [],
    ...over,
  });

  it('prefers the headline the release was given', () => {
    expect(
      summarise(
        entry({
          title: 'The first public release of scenri.',
          sections: [{ heading: 'Create', body: 'x' }],
        }),
      ),
    ).toBe('The first public release of scenri.');
  });

  it('falls back to the areas that changed', () => {
    expect(
      summarise(
        entry({
          sections: [
            { heading: 'Create', body: 'x' },
            { heading: 'Scenes', body: 'y' },
          ],
        }),
      ),
    ).toBe('Create, Scenes');
  });

  it('says nothing for a release with nothing to say', () => {
    expect(summarise(entry({}))).toBe('');
  });
});
