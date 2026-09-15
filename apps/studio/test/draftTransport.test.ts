import { describe, expect, it } from 'vitest';
import { acceptsDraft } from '../src/create/presenter/draftTransport.js';

const at = (id: string, updatedAt: string) => ({ id, updatedAt });

describe('what may become the draft on screen', () => {
  it('takes the first answer about the draft being asked for', () => {
    expect(acceptsDraft(null, at('pd-a', '2026-09-15T10:00:00.000Z'), 'pd-a')).toBe(true);
  });

  it('takes a newer answer about the same draft', () => {
    const held = at('pd-a', '2026-09-15T10:00:00.000Z');
    expect(acceptsDraft(held, at('pd-a', '2026-09-15T10:00:01.000Z'), 'pd-a')).toBe(true);
  });

  it('refuses an older answer that crossed a newer one', () => {
    const held = at('pd-a', '2026-09-15T10:00:05.000Z');
    expect(acceptsDraft(held, at('pd-a', '2026-09-15T10:00:01.000Z'), 'pd-a')).toBe(false);
  });

  it('takes an answer whose clock has not moved: the same read twice is not a conflict', () => {
    const held = at('pd-a', '2026-09-15T10:00:05.000Z');
    expect(acceptsDraft(held, at('pd-a', '2026-09-15T10:00:05.000Z'), 'pd-a')).toBe(true);
  });

  /**
   * The cross-draft contamination, as a rule.
   *
   * The poll runs on a 1.5s clock and a draft card is a link, so a read for one
   * draft routinely lands after the page has moved to another. The old rule
   * compared clocks only when the ids matched, so a mismatch fell through to
   * "take it" and the studio installed a draft nobody had asked for, pictures
   * and all. A newer clock made it worse, not better.
   */
  it('refuses an answer about a draft the page has left, however new it is', () => {
    const held = at('pd-b', '2026-09-15T10:00:00.000Z');
    expect(acceptsDraft(held, at('pd-a', '2026-09-15T23:59:59.000Z'), 'pd-b')).toBe(false);
  });

  it('refuses an answer about another draft even when nothing is held yet', () => {
    expect(acceptsDraft(null, at('pd-a', '2026-09-15T10:00:00.000Z'), 'pd-b')).toBe(false);
  });

  it('refuses everything once the page is on no draft at all', () => {
    expect(acceptsDraft(null, at('pd-a', '2026-09-15T10:00:00.000Z'), null)).toBe(false);
    const held = at('pd-a', '2026-09-15T10:00:00.000Z');
    expect(acceptsDraft(held, at('pd-a', '2026-09-15T10:00:01.000Z'), null)).toBe(false);
  });
});
