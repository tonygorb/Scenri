import { describe, it, expect } from 'vitest';
import { briefTokens, type BriefToken } from '../src/composer/line.js';

const HASH_A = 'a'.repeat(32);
const HASH_B = 'b'.repeat(32);

describe('briefTokens', () => {
  it('drops the format token and keeps the sentence', () => {
    const tokens: BriefToken[] = [
      { t: 'format', id: 'square', w: 1024, h: 1024 },
      { t: 'text', v: 'on a stone ledge' },
    ];
    expect(briefTokens({ tokens })).toEqual([{ t: 'text', v: 'on a stone ledge' }]);
  });

  it('folds a legacy bare templateId into a template chip', () => {
    const r = briefTokens({ tokens: [{ t: 'text', v: 'x' }], templateId: 'espresso-bar' });
    expect(r[0]).toEqual({ t: 'template', id: 'espresso-bar' });
  });

  // The detail view lists a carried mark as an ingredient of the shot, so
  // "reuse setup" has to rebuild the brief with it - the two disagreeing about
  // what the shot was is the reported inconsistency.
  it('appends inherited context after the shot own tokens', () => {
    const r = briefTokens({
      tokens: [{ t: 'text', v: 'warmer light' }],
      inherited: [
        { t: 'product', id: 'p1' },
        { t: 'mark', imageHash: HASH_A },
        { t: 'ref', imageHash: HASH_B },
      ],
    });
    expect(r).toEqual([
      { t: 'text', v: 'warmer light' },
      { t: 'product', id: 'p1' },
      { t: 'mark', imageHash: HASH_A },
      { t: 'ref', imageHash: HASH_B },
    ]);
  });

  it('never doubles a chip the brief already carries itself', () => {
    const r = briefTokens({
      tokens: [
        { t: 'mark', imageHash: HASH_A },
        { t: 'product', id: 'p1', angle: 'material-closeup' },
      ],
      inherited: [
        { t: 'mark', imageHash: HASH_A },
        // same product carried at another angle is still the same chip
        { t: 'product', id: 'p1' },
        { t: 'ref', imageHash: HASH_B },
      ],
    });
    expect(r).toEqual([
      { t: 'mark', imageHash: HASH_A },
      { t: 'product', id: 'p1', angle: 'material-closeup' },
      { t: 'ref', imageHash: HASH_B },
    ]);
  });

  it('a brief with only inherited context still yields a usable sentence', () => {
    const r = briefTokens({ tokens: [], inherited: [{ t: 'mark', imageHash: HASH_A }] });
    expect(r).toEqual([{ t: 'mark', imageHash: HASH_A }]);
  });

  it('still folds templateId when inherited context is present', () => {
    const r = briefTokens({
      tokens: [{ t: 'text', v: 'x' }],
      templateId: 'espresso-bar',
      inherited: [{ t: 'mark', imageHash: HASH_A }],
    });
    expect(r.map((t) => t.t)).toEqual(['template', 'text', 'mark']);
  });
});
