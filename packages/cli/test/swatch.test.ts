import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { vibrantColor } from '../src/swatch.js';

const solid = (r: number, g: number, b: number) =>
  sharp({ create: { width: 32, height: 32, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();

/** Mostly grey with a small vivid patch: the patch should win. */
async function greyWithAccent(): Promise<Buffer> {
  const base = sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 120, g: 120, b: 122 } } });
  const patch = await sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 240, g: 90, b: 20 } } })
    .png()
    .toBuffer();
  return base
    .composite([{ input: patch, top: 4, left: 4 }])
    .png()
    .toBuffer();
}

const hueOf = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  if (d === 0) return 0;
  if (max === r) return (((g - b) / d + (g < b ? 6 : 0)) * 60) % 360;
  if (max === g) return ((b - r) / d + 2) * 60;
  return ((r - g) / d + 4) * 60;
};

describe('vibrantColor', () => {
  it('reads a saturated image as its own hue', async () => {
    const hex = await vibrantColor(await solid(240, 90, 20)); // orange
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(hueOf(hex!)).toBeGreaterThan(5);
    expect(hueOf(hex!)).toBeLessThan(45);
  });

  it('finds the accent inside a mostly grey image', async () => {
    const hex = await vibrantColor(await greyWithAccent());
    expect(hueOf(hex!)).toBeGreaterThan(5);
    expect(hueOf(hex!)).toBeLessThan(45);
  });

  it('falls back to the dominant bin when nothing is colourful', async () => {
    const hex = await vibrantColor(await solid(130, 130, 130));
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const r = parseInt(hex!.slice(1, 3), 16);
    const b = parseInt(hex!.slice(5, 7), 16);
    expect(Math.abs(r - b)).toBeLessThan(12); // still grey, not invented colour
  });

  it('returns null for input that is not an image', async () => {
    expect(await vibrantColor(Buffer.from('not an image'))).toBeNull();
  });
});
