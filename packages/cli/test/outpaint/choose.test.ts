import { describe, expect, it } from 'vitest';
import { chooseExpand } from '../../src/outpaint/choose.js';
import { SEAM_VISIBLE } from '../../src/seamScore.js';

const bed = (seam: number) => ({ image: Buffer.from('bed'), seam, from: 'bed' as const });
const padded = (seam: number) => ({ image: Buffer.from('padded'), seam, from: 'padded' as const });
const reframed = () => ({ image: Buffer.from('reframed') });

describe('chooseExpand', () => {
  it('keeps the exact pixels when nobody can see the join', () => {
    const d = chooseExpand({ preserved: [bed(0.86), padded(1.36)], reframed: reframed() });
    expect(d?.choice).toBe('preserved');
    expect(d?.reason).toBe('join-invisible');
    expect(d?.image.toString()).toBe('bed');
  });

  it('takes the better join, whichever draw it came from', () => {
    // The presenter shot from the 2026-08-26 battery: the bed answer joins at
    // 7.65 and would have been given up on; the padded answer joins at 1.68 and
    // keeps the photograph. Both composites are exact in the middle, so the
    // only thing to rank them by is the join.
    const d = chooseExpand({ preserved: [bed(7.65), padded(1.68)], reframed: reframed() });
    expect(d?.choice).toBe('preserved');
    expect(d?.from).toBe('padded');
    expect(d?.seam).toBe(1.68);
    expect(d?.image.toString()).toBe('padded');
  });

  it('gives the photograph up only when neither composite can carry the join', () => {
    const d = chooseExpand({ preserved: [bed(7.65), padded(4.03)], reframed: reframed() });
    expect(d?.choice).toBe('reframed');
    expect(d?.reason).toBe('join-visible');
    // The seam reported is the best that was achievable, not the worst tried.
    expect(d?.seam).toBe(4.03);
  });

  it('treats the threshold itself as visible', () => {
    expect(chooseExpand({ preserved: [bed(SEAM_VISIBLE)], reframed: reframed() })?.choice).toBe('reframed');
    expect(chooseExpand({ preserved: [bed(SEAM_VISIBLE - 0.01)], reframed: reframed() })?.choice).toBe('preserved');
  });

  it('keeps the exact pixels when the surface is too flat to judge', () => {
    // seamScore answers 1 when the surface has no ordinary variation to compare
    // against. That is absence of evidence, and absence of evidence must not
    // cost the guarantee.
    expect(chooseExpand({ preserved: [bed(1)], reframed: reframed() })?.choice).toBe('preserved');
  });

  it('ships whichever candidate exists when only one does', () => {
    expect(chooseExpand({ preserved: [bed(9)], reframed: null })).toMatchObject({
      choice: 'preserved',
      reason: 'only-candidate',
    });
    expect(chooseExpand({ preserved: [], reframed: reframed() })).toMatchObject({
      choice: 'reframed',
      reason: 'only-candidate',
    });
  });

  it('has nothing to say when neither draw produced anything', () => {
    expect(chooseExpand({ preserved: [], reframed: null })).toBeNull();
  });

  it('prefers exact pixels: only a join nobody could hide displaces them', () => {
    for (const seam of [0, 0.4, 1.19, 2.19]) {
      expect(chooseExpand({ preserved: [bed(seam)], reframed: reframed() })?.choice).toBe('preserved');
    }
    for (const seam of [2.2, 3.06, 7.65, 21.83]) {
      expect(chooseExpand({ preserved: [bed(seam)], reframed: reframed() })?.choice).toBe('reframed');
    }
  });
});
