import { describe, expect, it } from 'vitest';
import { named } from '../src/create/flow.js';

/**
 * The one question a create flow asks its own library.
 *
 * It exists to tell a build that landed before the server forgot it from one
 * that never finished, so its only job is to match the name someone typed into
 * the form the draft was sent from.
 */
describe('named', () => {
  const rows = [{ name: 'Low Terrace' }, { name: 'Fixture studio' }];

  it('finds an exact name', () => {
    expect(named(rows, 'Low Terrace')).toBe(true);
  });

  it('ignores case and the spaces around it, the way a person reading would', () => {
    expect(named(rows, '  low terrace ')).toBe(true);
    expect(named(rows, 'FIXTURE STUDIO')).toBe(true);
  });

  it('is false for a name nobody has taken', () => {
    expect(named(rows, 'Low Terrace II')).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(named([], 'Low Terrace')).toBe(false);
  });

  /**
   * A draft with no name was never submitted, so it can never be the record of
   * a build that landed. Matching it against a row that also has none would
   * clear somebody's photographs for nothing.
   */
  it('is false for an empty name, whatever the list holds', () => {
    expect(named(rows, '')).toBe(false);
    expect(named(rows, '   ')).toBe(false);
    expect(named([{ name: '' }], '')).toBe(false);
  });
});
