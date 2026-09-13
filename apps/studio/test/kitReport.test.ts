import { describe, expect, it } from 'vitest';
import type { ScrapeReport } from '../src/api.js';
import { kitLines, kitNeedsHand } from '../src/views/kitReport.js';

/**
 * "No products found" was never the failure. This is: a kit that came back
 * with a name and colours and no logo used to look exactly like one that came
 * back with everything, because the screen navigated away without saying
 * anything. Partial has to read as success, and as specific.
 */

const report = (over: Partial<ScrapeReport> = {}): ScrapeReport => ({
  url: 'https://lucid.example/',
  host: 'lucid.example',
  name: { value: 'Lucid', source: 'title' },
  tagline: 'Bookkeeping and taxes',
  logo: { status: 'primary', source: 'header-img' },
  colors: { count: 4 },
  ...over,
});

describe('kitLines', () => {
  it('names what was found', () => {
    expect(kitLines(report())).toEqual([
      { key: 'name', found: true, label: 'Name', value: 'Lucid' },
      { key: 'logo', found: true, label: 'Logo', value: 'found on the site' },
      { key: 'colors', found: true, label: 'Colours', value: '4 taken from the site' },
    ]);
  });

  it('is honest about a name that is really just the address', () => {
    const line = kitLines(report({ name: { value: 'lucid.example', source: 'hostname' } }))[0];
    expect(line.found).toBe(false);
    expect(line.value).toContain('lucid.example');
  });

  it('says a small mark is a small mark rather than claiming a logo', () => {
    const line = kitLines(report({ logo: { status: 'alternate', source: 'link-icon' } }))[1];
    expect(line.found).toBe(true);
    expect(line.value).toContain('alternate');
  });

  it('reports each part on its own, so one miss does not hide two hits', () => {
    const lines = kitLines(report({ logo: { status: 'none', source: null } }));
    expect(lines.filter((l) => l.found).map((l) => l.key)).toEqual(['name', 'colors']);
  });
});

describe('kitNeedsHand', () => {
  it('is quiet when the site gave up everything', () => {
    expect(kitNeedsHand(report())).toBe(false);
  });

  it.each([
    ['no logo', { logo: { status: 'none' as const, source: null } }],
    ['only a favicon', { logo: { status: 'alternate' as const, source: 'link-icon' } }],
    ['no colours', { colors: { count: 0 } }],
    ['a name off the address', { name: { value: 'x.example', source: 'hostname' as const } }],
  ])('asks for a person when there is %s', (_what, over) => {
    expect(kitNeedsHand(report(over))).toBe(true);
  });
});
