import { describe, expect, it } from 'vitest';
import { collectColors, dedupeNearby, dropSingletons, paletteFrom, pickPalette, weightOf } from '../src/colors.js';

/**
 * A palette is a decision, not an inventory. A homepage carries forty colours,
 * most of them greys a fraction apart, and handing someone all of them is the
 * same as handing them none.
 */

describe('what a colour is worth, by where it was written', () => {
  it('counts a named brand variable far above an incidental fill', () => {
    expect(weightOf({ hex: '#4d61fc', property: '--brand-primary', context: ':root' })).toBeGreaterThan(
      weightOf({ hex: '#eeeeee', property: 'border-color', context: '.card' }),
    );
  });

  it('counts a colour on something people click above one in body text', () => {
    expect(weightOf({ hex: '#4d61fc', property: 'background', context: '.btn-primary' })).toBeGreaterThan(
      weightOf({ hex: '#303030', property: 'color', context: '.footnote' }),
    );
  });
});

describe('collapsing what nobody could tell apart', () => {
  it('keeps one of a cluster, and gives it the weight of the whole cluster', () => {
    const out = dedupeNearby([
      { hex: '#4d61fc', weight: 6 },
      { hex: '#4d62fd', weight: 2 },
      { hex: '#f90473', weight: 4 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ hex: '#4d61fc', weight: 8 });
  });

  it('collapses a page full of greys into one neutral', () => {
    const greys = ['#f6f6f6', '#f5f5f5', '#f7f7f7', '#f4f4f4'].map((hex) => ({ hex, weight: 1 }));
    expect(dedupeNearby(greys)).toHaveLength(1);
  });

  it('drops once-seen colours only when there are plenty of others', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ hex: `#0000${i.toString(16).padStart(2, '0')}`, weight: 1 }));
    expect(dropSingletons([...many, { hex: '#4d61fc', weight: 9 }])).toEqual([{ hex: '#4d61fc', weight: 9 }]);
    expect(dropSingletons([{ hex: '#4d61fc', weight: 1 }])).toHaveLength(1);
  });
});

describe('the palette that comes out', () => {
  it('leads with the colours a person would call the brand', () => {
    const p = pickPalette([
      { hex: '#303030', weight: 100 },
      { hex: '#4d61fc', weight: 76 },
      { hex: '#f90473', weight: 49 },
      { hex: '#00396b', weight: 46 },
    ]);
    expect(p.primary).toBe('#4d61fc');
    expect(p.secondary).toBe('#f90473');
    expect(p.neutrals).toContain('#303030');
  });

  it('invents nothing when a page is all greys', () => {
    expect(pickPalette([{ hex: '#f6f6f6', weight: 9 }]).primary).toBeUndefined();
  });

  // The whole pass, on the shape a real stylesheet has.
  it('reads a Tailwind-style sheet that declares everything in oklch', () => {
    const p = paletteFrom([
      {
        css: ':root{--brand-primary:oklch(0.55 0.22 264);--brand-accent:oklch(0.62 0.24 350);--gray:#f6f6f6}.btn{background:var(--brand-primary)}',
      },
    ]);
    expect(p.primary).toBeDefined();
    expect(p.primary).not.toBe('#f6f6f6');
  });

  it('counts the same colour from two sheets once, with both weights', () => {
    const hits = collectColors([{ css: '.a{color:#4d61fc}' }, { css: '.b{color:#4d61fc}' }]);
    expect(hits).toEqual([{ hex: '#4d61fc', weight: 2 }]);
  });
});
