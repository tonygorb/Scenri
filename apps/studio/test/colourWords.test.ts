import { describe, expect, it } from 'vitest';
import { colourWords, grownHair, hsl } from '../src/create/presenter/colourWords.js';

const name = (hex: string) => colourWords(hex).name;

describe('the word for a colour', () => {
  it('says a grey by how light it is, and never by a hue it does not have', () => {
    expect(name('#000000')).toBe('black');
    expect(name('#1b1b1b')).toBe('charcoal');
    expect(name('#3d3d3d')).toBe('dark grey');
    expect(name('#8d8d8d')).toBe('grey');
    expect(name('#bcbcbc')).toBe('light grey');
    expect(name('#dcdcdc')).toBe('silver');
    expect(name('#f4f4f4')).toBe('off-white');
    expect(name('#ffffff')).toBe('white');
    // a colour with almost no saturation is a grey whatever its hue reads as
    expect(name('#4a4d4a')).toBe('dark grey');
  });

  it('names the warm end the way a person does, not as a dark orange', () => {
    expect(name('#3b2418')).toBe('dark brown');
    expect(name('#6b4630')).toBe('brown');
    expect(name('#8c5a3c')).toBe('brown');
    expect(name('#a9713f')).toBe('tan');
    expect(name('#ddb894')).toBe('beige');
    expect(name('#f4e0d4')).toBe('cream');
    expect(name('#c2622a')).toBe('orange');
    expect(name('#e07b28')).toBe('orange');
  });

  it('names the reds apart from one another', () => {
    expect(name('#c62f2f')).toBe('red');
    expect(name('#ff2d2d')).toBe('vivid red');
    expect(name('#7a1f1f')).toBe('maroon');
    expect(name('#5a2130')).toBe('burgundy');
    expect(name('#ff9a9a')).toBe('light red');
  });

  it('covers the cool half in words people use', () => {
    expect(name('#4a9c5c')).toBe('green');
    expect(name('#1f7a45')).toBe('dark green');
    expect(name('#2f9c96')).toBe('teal');
    expect(name('#22c7d6')).toBe('cyan');
    expect(name('#3a6fd0')).toBe('blue');
    expect(name('#1a2f80')).toBe('dark blue');
    // bluer than purple, and now said so: the whole point of naming by hue
    expect(name('#8154c9')).toBe('violet');
    expect(name('#7f3fbf')).toBe('purple');
    expect(name('#e074a8')).toBe('pink');
    // the everyday word wins over the hue band it sits in
    expect(name('#b8b3d6')).toBe('lavender');
    expect(name('#101a4d')).toBe('navy');
  });

  it('reads the yellows as gold and olive rather than as dark yellow', () => {
    expect(name('#d8ac63')).toBe('gold');
    expect(name('#e9c93f')).toBe('yellow');
    expect(name('#5c5320')).toBe('olive');
    expect(name('#6f6a1e')).toBe('olive');
  });

  it('keeps a name to two words at most, and never an empty one', () => {
    for (let h = 0; h < 360; h += 7) {
      for (const s of [0.05, 0.2, 0.5, 0.95]) {
        for (const l of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) {
          const hex = hslHex(h, s, l);
          const said = name(hex);
          expect(said.trim().length, hex).toBeGreaterThan(2);
          expect(said.split(' ').length, `${hex} -> ${said}`).toBeLessThanOrEqual(3);
          expect(said, hex).toBe(said.toLowerCase());
        }
      }
    }
  });

  it('reads its own hex back: the words come from the colour, not from a table of twelve', () => {
    // every family the wheel can land in is reachable, so nothing collapses
    const families = new Set<string>();
    for (let h = 0; h < 360; h += 3) families.add(colourWords(hslHex(h, 0.7, 0.5)).family);
    expect(families.size).toBeGreaterThanOrEqual(14);
  });

  it('knows what hair grows in and what was put there', () => {
    expect(grownHair('#3b2418')).toBe(true);
    expect(grownHair('#8c3b26')).toBe(true);
    expect(grownHair('#d8ac63')).toBe(true);
    expect(grownHair('#9b9b99')).toBe(true);
    expect(grownHair('#f0efed')).toBe(true);
    expect(grownHair('#7f3fbf')).toBe(false);
    expect(grownHair('#2f9c96')).toBe(false);
    expect(grownHair('#e074a8')).toBe(false);
  });

  it('reads hue, saturation and lightness the way the wheel does', () => {
    expect(Math.round(hsl('#ff0000').h)).toBe(0);
    expect(Math.round(hsl('#00ff00').h)).toBe(120);
    expect(Math.round(hsl('#0000ff').h)).toBe(240);
    expect(hsl('#808080').s).toBeLessThan(0.01);
    expect(hsl('#000000').l).toBe(0);
    expect(hsl('#ffffff').l).toBe(1);
    // shorthand and case are the same colour
    expect(hsl('#FFF').l).toBe(1);
  });
});

/** A hex from hue, saturation and lightness, so the battery can walk the wheel. */
function hslHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const two = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${two(r)}${two(g)}${two(b)}`;
}
