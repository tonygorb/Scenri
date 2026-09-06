import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The desktop launcher's icons ship inside the npm package and are generated
 * from apps/studio/brand/scenri-symbol.svg by apps/studio/scripts/brand-icons.mjs,
 * then committed. These tests read the committed bytes as the OS would: a
 * Windows .ico directory and an Apple .icns container, both holding PNG
 * payloads whose IHDR agrees with the size the entry claims. A regenerated
 * asset that drifts from either format fails here, not on a user's Desktop.
 */

const launcherDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'launcher');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(0, 8).equals(PNG_SIG)).toBe(true);
  expect(png.toString('latin1', 12, 16)).toBe('IHDR');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('the Windows icon (launcher/scenri.ico)', () => {
  const path = join(launcherDir, 'scenri.ico');

  it('exists and is small', () => {
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeLessThan(120 * 1024);
  });

  it('is an icon directory of PNG frames whose sizes match their entries', () => {
    const ico = readFileSync(path);
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // 1 = icon, 2 = cursor
    const count = ico.readUInt16LE(4);
    const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const e = 6 + i * 16;
      const claimed = ico.readUInt8(e) || 256;
      const length = ico.readUInt32LE(e + 8);
      const offset = ico.readUInt32LE(e + 12);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      const { width, height } = pngSize(ico.subarray(offset, offset + length));
      expect(width).toBe(claimed);
      expect(height).toBe(claimed);
      sizes.push(claimed);
    }
    // Explorer picks 16 and 32 for lists, 48 for the Desktop, 256 for large icons.
    for (const s of [16, 32, 48, 256]) expect(sizes).toContain(s);
  });
});

describe('the macOS icon (launcher/Scenri.icns)', () => {
  const path = join(launcherDir, 'Scenri.icns');
  // The PNG-payload types, with the pixel size each one carries.
  const PIXELS: Record<string, number> = {
    ic11: 32, // 16@2x
    ic12: 64, // 32@2x
    ic07: 128,
    ic13: 256, // 128@2x
    ic08: 256,
    ic14: 512, // 256@2x
    ic09: 512,
    ic10: 1024, // 512@2x
  };

  it('exists and is small', () => {
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeLessThan(200 * 1024);
  });

  it('is an icns container whose PNG entries match their type sizes', () => {
    const icns = readFileSync(path);
    expect(icns.toString('latin1', 0, 4)).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    const seen: string[] = [];
    let offset = 8;
    while (offset < icns.length) {
      const type = icns.toString('latin1', offset, offset + 4);
      const length = icns.readUInt32BE(offset + 4);
      expect(length).toBeGreaterThan(8);
      const payload = icns.subarray(offset + 8, offset + length);
      if (type in PIXELS) {
        const { width, height } = pngSize(payload);
        expect(width).toBe(PIXELS[type]);
        expect(height).toBe(PIXELS[type]);
        seen.push(type);
      }
      offset += length;
    }
    expect(offset).toBe(icns.length);
    for (const type of Object.keys(PIXELS)) expect(seen).toContain(type);
  });
});
