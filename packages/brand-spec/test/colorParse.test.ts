import { describe, expect, it } from 'vitest';
import { extractColors, toHex } from '../src/colorParse.js';

/**
 * The rule this replaces read six-digit hex and nothing else. A site built on
 * Tailwind v4 writes its whole palette in oklch(), so the kit came back with
 * no colours at all - which reads to a person as "Scenri could not understand
 * my website".
 */

describe('toHex', () => {
  it.each([
    ['#4D61FC', '#4d61fc'],
    ['#abc', '#aabbcc'],
    ['#abcd', '#aabbcc'],
    ['#4d61fcff', '#4d61fc'],
    ['rgb(77, 97, 252)', '#4d61fc'],
    ['rgb(77 97 252)', '#4d61fc'],
    ['rgba(77, 97, 252, 0.9)', '#4d61fc'],
    ['rgb(100% 0% 0%)', '#ff0000'],
    ['hsl(0, 100%, 50%)', '#ff0000'],
    ['hsl(120 100% 25%)', '#008000'],
    ['hsla(240, 100%, 50%, 1)', '#0000ff'],
  ])('reads %s as %s', (input, expected) => {
    expect(toHex(input)).toBe(expected);
  });

  // Checked against the published oklch conversion: pure white, pure black,
  // and a mid red that lands where sRGB red is.
  it('reads oklch, which is what a modern stylesheet is full of', () => {
    expect(toHex('oklch(1 0 0)')).toBe('#ffffff');
    expect(toHex('oklch(0 0 0)')).toBe('#000000');
    const red = toHex('oklch(0.628 0.2577 29.23)');
    expect(red).not.toBeNull();
    expect(Number.parseInt((red as string).slice(1, 3), 16)).toBeGreaterThan(230);
    expect(Number.parseInt((red as string).slice(3, 5), 16)).toBeLessThan(40);
  });

  it('reads a percentage lightness in oklch the same way', () => {
    expect(toHex('oklch(100% 0 0)')).toBe('#ffffff');
  });

  // A colour you can see through says nothing about a brand.
  it.each(['rgba(0,0,0,0.1)', '#00000010', 'hsla(0,0%,0%,0.05)'])('skips %s as too transparent', (input) => {
    expect(toHex(input)).toBeNull();
  });

  it.each(['', 'inherit', 'currentColor', 'var(--brand)', '#12', 'url(x.png)'])('is not fooled by %j', (input) => {
    expect(toHex(input)).toBeNull();
  });
});

describe('extractColors', () => {
  it('keeps the property a colour was declared on, so a brand variable can outrank a border', () => {
    const hits = extractColors(':root{--brand-primary:#4d61fc;--radius:4px}.b{border-color:#eeeeee}');
    expect(hits).toEqual([
      { hex: '#4d61fc', property: '--brand-primary', context: expect.any(String) },
      { hex: '#eeeeee', property: 'border-color', context: expect.any(String) },
    ]);
  });

  it('finds every notation in one sheet', () => {
    const hits = extractColors('.a{color:#abc;background:rgb(1 2 3);outline:hsl(0 0% 50%);fill:oklch(1 0 0)}');
    expect(hits.map((h) => h.hex)).toEqual(['#aabbcc', '#010203', '#808080', '#ffffff']);
  });

  it('carries the selector along, so a button colour can be weighted above a footnote', () => {
    const hits = extractColors('.btn-primary{background:#4d61fc}');
    expect(hits[0].context).toContain('.btn-primary');
  });

  it('finds nothing in a sheet with no colours, rather than guessing', () => {
    expect(extractColors('.a{margin:0;padding:4px}')).toEqual([]);
  });
});
