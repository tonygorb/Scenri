import { describe, expect, it } from 'vitest';
import { load } from 'cheerio';
import {
  collectColors,
  dedupeNearby,
  dropSingletons,
  liveClassTokens,
  paletteFrom,
  pickPalette,
  roleOfProperty,
  selectorIsLive,
  weightOf,
} from '../src/colors.js';

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

/**
 * A page builder ships every theme it offers in one stylesheet and marks the
 * live one on the html element. The real www.lucid.now declares
 * `.style-blue-3 { --primary: #518ce8; --secondary: #f80673 }` and wears
 * `class="style-blue-3"`, and a flat count handed back a pink primary lifted
 * from a theme it does not use, with two greens for accents.
 */
describe('a site that declares its own palette', () => {
  const THEMED = `
    .style-blue-1{--primary:#4d61fc;--primary-dark:#344bfb;--accent:#4d61fc;--secondary:#f80673}
    .style-green-2{--primary:#0a6b01;--accent:#4addb4;--secondary:#4bca81}
    .style-blue-3:not(.custom-colors-enabled){--primary:#518ce8;--primary-dark:#397ee5;--accent:#518ce8;--secondary:#f80673}
    .style-blue-3{--dark:#01396b;--light:#e8f1ff}
    .style-green-2 .hero{background:#4addb4;color:#4bca81;border-color:#4addb4}
    .style-blue-3 .btn-primary{background:#518ce8}
    body{color:#303030}
  `;

  it('believes the names the designer wrote, for the theme the page is wearing', () => {
    const p = paletteFrom([{ css: THEMED }], ['style-blue-3']);
    expect(p.primary).toBe('#518ce8');
    expect(p.secondary).toBe('#f80673');
  });

  it('ignores the palettes of every theme the page is not wearing', () => {
    const p = paletteFrom([{ css: THEMED }], ['style-blue-3']);
    const shipped = [p.primary, p.secondary, ...p.accent, ...p.neutrals];
    // The greens belong to .style-green-2 and appear more often than anything.
    expect(shipped).not.toContain('#4addb4');
    expect(shipped).not.toContain('#4bca81');
  });

  it('never lets a -dark or -hover variant take the base slot', () => {
    expect(paletteFrom([{ css: THEMED }], ['style-blue-3']).primary).not.toBe('#397ee5');
  });

  it('does not show the same colour twice when accent repeats primary', () => {
    const p = paletteFrom([{ css: THEMED }], ['style-blue-3']);
    expect(p.accent).not.toContain(p.primary);
  });

  /**
   * The real page ships three kinds of --accent: its live theme's, a dozen
   * other themes', and a bundled widget's bare :root (Tailwind sky-500, and
   * last in the file). Source order alone handed back the widget's.
   */
  it('prefers the theme the page wears over the defaults a bundled widget brought', () => {
    const withWidget = `${THEMED}\n:root{--foreground:#0f172a;--muted:#475569;--accent:#0ea5e9}`;
    const p = paletteFrom([{ css: withWidget }], ['style-blue-3']);
    expect([p.primary, p.secondary, ...p.accent]).not.toContain('#0ea5e9');
  });

  it('takes the dark and light a theme declares as accents, since they are brand colours', () => {
    const p = paletteFrom([{ css: THEMED }], ['style-blue-3']);
    expect(p.accent).toEqual(['#01396b', '#e8f1ff']);
  });

  // An ordinary site names nothing and scopes nothing; counting is all there is.
  it('changes nothing for a page with one plain stylesheet', () => {
    const plain = '.btn{background:#4d61fc}.hero{color:#f90473}body{color:#303030}';
    expect(paletteFrom([{ css: plain }], ['some-class']).primary).toBe(paletteFrom([{ css: plain }]).primary);
  });
});

describe('reading the live theme off the document', () => {
  it('takes the classes from html and body together', () => {
    const $ = load('<html class="style-blue-3 comps"><body class="font-work-sans"></body></html>');
    expect(liveClassTokens($).sort()).toEqual(['comps', 'font-work-sans', 'style-blue-3']);
  });

  it.each([
    [':root', true],
    ['html', true],
    ['.style-blue-3', true],
    ['.style-blue-3:not(.custom-colors-enabled)', true],
    ['.style-blue-1, .style-blue-2, .style-blue-3', true],
    ['.style-green-2', false],
    ['.style-green-2 .hero', false],
  ])('reads %j as live=%s', (selector, live) => {
    expect(selectorIsLive(selector, ['style-blue-3'])).toBe(live);
  });

  it.each([
    ['--primary', 'primary', false],
    ['--brand-primary', 'primary', false],
    ['--color-secondary', 'secondary', false],
    ['--accent', 'accent', false],
    ['--primary-dark', 'primary', true],
    ['--secondary-hover', 'secondary', true],
    ['--accent-600', 'accent', true],
  ])('reads %j as the %s slot (variant=%s)', (property, role, variant) => {
    expect(roleOfProperty(property)).toEqual({ role, variant });
  });

  it.each(['--radius', '--font-body', 'color', '--primarily-wrong'])('reads %j as no slot at all', (property) => {
    expect(roleOfProperty(property)).toBeNull();
  });
});
