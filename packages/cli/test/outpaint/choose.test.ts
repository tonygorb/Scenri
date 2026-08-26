import { describe, expect, it } from 'vitest';
import { chooseExpand } from '../../src/outpaint/choose.js';
import { SEAM_VISIBLE } from '../../src/seamScore.js';

const preserved = (seam: number) => ({ image: Buffer.from('preserved'), seam });
const reframed = () => ({ image: Buffer.from('reframed') });

describe('chooseExpand', () => {
  it('keeps the exact pixels when nobody can see the join', () => {
    const d = chooseExpand({ preserved: preserved(0.86), reframed: reframed() });
    expect(d?.choice).toBe('preserved');
    expect(d?.reason).toBe('join-invisible');
    expect(d?.image.toString()).toBe('preserved');
  });

  it('gives the exact pixels up only when the join shows', () => {
    // The presenter shot from the 2026-08-26 battery: 7.65 against a threshold
    // of 2.2, and the one frame in six a person could point at.
    const d = chooseExpand({ preserved: preserved(7.65), reframed: reframed() });
    expect(d?.choice).toBe('reframed');
    expect(d?.reason).toBe('join-visible');
    expect(d?.seam).toBe(7.65);
  });

  it('treats the threshold itself as visible', () => {
    expect(chooseExpand({ preserved: preserved(SEAM_VISIBLE), reframed: reframed() })?.choice).toBe('reframed');
    expect(chooseExpand({ preserved: preserved(SEAM_VISIBLE - 0.01), reframed: reframed() })?.choice).toBe('preserved');
  });

  it('keeps the exact pixels when the surface is too flat to judge', () => {
    // seamScore answers 1 when the surface has no ordinary variation to compare
    // against. That is absence of evidence, and absence of evidence must not
    // cost the guarantee.
    const d = chooseExpand({ preserved: preserved(1), reframed: reframed() });
    expect(d?.choice).toBe('preserved');
  });

  it('ships whichever candidate exists when only one does', () => {
    expect(chooseExpand({ preserved: preserved(9), reframed: null })).toMatchObject({
      choice: 'preserved',
      reason: 'only-candidate',
    });
    expect(chooseExpand({ preserved: null, reframed: reframed() })).toMatchObject({
      choice: 'reframed',
      reason: 'only-candidate',
    });
  });

  it('has nothing to say when neither draw produced anything', () => {
    expect(chooseExpand({ preserved: null, reframed: null })).toBeNull();
  });

  it('prefers exact pixels: a visible join is the only thing that displaces them', () => {
    // Guard the direction of the rule, not just its outcomes. Every seam below
    // the threshold must keep the original, at any value.
    for (const seam of [0, 0.4, 1.19, 2.19]) {
      expect(chooseExpand({ preserved: preserved(seam), reframed: reframed() })?.choice).toBe('preserved');
    }
    for (const seam of [2.2, 3.06, 7.65, 21.83]) {
      expect(chooseExpand({ preserved: preserved(seam), reframed: reframed() })?.choice).toBe('reframed');
    }
  });
});
