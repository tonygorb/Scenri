import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHeat } from '../src/views/settings/usageRules.js';

// Settings > Usage: one square per day, Sunday-aligned, the last column this week.
describe('buildHeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // a Saturday afternoon, this computer's time
    vi.setSystemTime(new Date(2026, 8, 26, 15, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("draws this week's runs: the grid ends today, not on the last Sunday", () => {
    const heat = buildHeat(new Map([['2026-09-26', 4]]), 53);
    expect(heat.cells.at(-1)?.key).toBe('2026-09-26');
    // a first week of use is not "nothing made yet this year"
    expect(heat.sum).toBe(4);
    expect(heat.cells.at(-1)?.title).toBe('4 runs on 26 Sep');
  });

  it('opens on a Sunday, one column per week, and says which day it starts on', () => {
    const heat = buildHeat(new Map(), 13);
    // twelve whole weeks back from this week's Sunday (20 Sep)
    expect(heat.from).toBe('2026-06-28');
    expect(heat.cells[0].key).toBe('2026-06-28');
    expect(new Date(2026, 5, 28).getDay()).toBe(0);
    expect(heat.cells).toHaveLength(12 * 7 + 7);
    expect(heat.months).toHaveLength(13);
  });

  it('keys each square by its local calendar day, whatever the hour', () => {
    // just after midnight: east of UTC this is still yesterday in UTC
    vi.setSystemTime(new Date(2026, 8, 26, 0, 30));
    const heat = buildHeat(new Map([['2026-09-26', 1]]), 1);
    expect(heat.cells.map((c) => c.key)).toEqual([
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
    ]);
    expect(heat.sum).toBe(1);
  });
});
